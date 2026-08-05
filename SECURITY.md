# Security model — Agent Runner

This subsystem executes code written by a language model. That is a genuinely
dangerous thing to do, and this document is an honest account of what the
isolation actually buys, where it is deliberately incomplete, and what the
production answer would be.

Nothing here is theoretical hardening for its own sake. Every control below
exists because of a specific thing that goes wrong without it.

---

## 1. Docker is not a security boundary

**Containers share the host kernel.** A container is a process with namespaces,
cgroups and a restricted capability set — not a machine. Every syscall the
sandboxed program makes is serviced by the *host's* kernel. A kernel privilege
escalation bug (Dirty COW, Dirty Pipe, io_uring bugs, netfilter and eBPF
verifier flaws — this class is found regularly) is reachable from inside the
container, and exploiting it means owning the host, not the container.

The controls in this repo raise the cost of an escape and eliminate whole
categories of *ordinary* misbehaviour. They do not make Docker a hard boundary
against a determined attacker with a kernel exploit. Anyone who tells you a
plain Docker container safely runs hostile code is wrong.

**The realistic threat model here is not a targeted attacker.** It is a model
that writes an infinite loop, a fork bomb, a 12 GB log, a program that tries to
`npm install`, or code that reads files it should not. Against *that* — which is
what actually happens — these controls are effective and sufficient.

### What is applied to every sandbox container

Set in [`executor.js`](server/src/agent-runner/sandbox/executor.js), because an
image cannot enforce any of it:

| Control | Value | What it prevents |
| --- | --- | --- |
| `NetworkMode` | `none` | Exfiltration, C2, dependency fetching. No interface exists to configure — this is stronger than a firewall rule. |
| `ReadonlyRootfs` | `true` | Persisting anything outside the workspace; tampering with system binaries. |
| `Tmpfs /workspace`, `/tmp` | `noexec,nosuid,nodev`, size-capped | The only writable paths. `noexec` blocks dropping a binary and running it; `nosuid` blocks setuid escalation. |
| `Memory` + `MemorySwap` | 512 MB, equal | Memory exhaustion. **Both** are required — without `MemorySwap`, a container exceeds its memory cap by swapping. |
| `NanoCpus` | 0.5 | CPU starvation of the host. |
| `PidsLimit` | 128 | Fork bombs. |
| `CapDrop` | `ALL` | Every capability-gated syscall: raw sockets, mount, ptrace, module loading. |
| `SecurityOpt` | `no-new-privileges` | Escalation through setuid binaries. |
| `User` | `1000:1000` | Running as root inside the container. |
| `Privileged` | never | The obvious total escape. |
| Wall clock | 30 s → `SIGKILL` | Infinite loops. SIGKILL, not SIGTERM: hostile code must not be able to trap the signal. |
| Output cap | 1 MB shared across stdout+stderr | A log bomb OOM-ing the *host process* that reads the stream. |
| Cleanup | `finally` + boot reaper | Leaked containers holding memory reservations. |

Verified against a real daemon: a DNS lookup fails with `EAI_AGAIN`, writing to
`/etc/` fails with `EROFS`, and `while(true){}` is killed at the deadline with no
container left behind.

---

## 2. The `/artifacts` bind mount is a deliberate hole

**This is the one place sandboxed code writes to the host filesystem.**
Everything else above is a wall; this is a door, and it is open on purpose.

A run's output has to survive the container. It cannot leave any other way: there
is no network, the rootfs is read-only, and `/workspace` is a tmpfs that the
kernel tears down when the container stops — so even `docker cp`/`getArchive`
after exit recovers nothing. So `<artifacts>/<runId>` is bind-mounted read-write
at `/workspace/out`.

### What constrains it

- **Per-run scoping.** Only `<artifacts>/<runId>` is mounted, never the artifacts
  root. This is the important one: mounting the root would let any run read,
  overwrite, or corrupt every other run's output, and a run that produced a
  clean artifact could have it silently replaced by a later one.
- **uid 1000, `CapDrop ALL`.** Files are created unprivileged.
- **Only `/workspace/out` is writable.** The rest of the workspace is tmpfs that
  dies with the container.
- **Read-back is defensive.** On collection, only regular top-level files are
  accepted; directories and symlinks are skipped rather than followed, filenames
  must match `[A-Za-z0-9._-]+`, and there are 5 MB/file and 20 file/run caps.
  Downloads re-validate the name and confirm the resolved path is still inside
  the run's own directory.

### What it does not constrain — stated plainly

- The directory is created `0777` so the uid-1000 container can write to it
  regardless of which uid the API process runs as. On a shared host, any local
  user can read and write that directory.
- Within its own directory, the sandboxed program has **unrestricted write
  access to real host storage**. It can fill it to the size of the host disk —
  there is no per-run quota on the bind mount, only on the tmpfs.
- Anything reading artifacts is consuming **model-generated bytes**. The download
  route serves them `application/octet-stream` with `nosniff` and
  `Content-Disposition: attachment` specifically so they are never interpreted as
  HTML in the user's origin. Any future consumer must be equally careful.

### The production answer

Per-run scoping plus a **virtual filesystem** rather than a host bind: expose a
9p/virtio-fs or FUSE mount backed by object storage, with a hard per-run quota
enforced by the filesystem layer, so "write to the host" is never literally what
happens. Failing that, a dedicated per-run volume with a quota, on a filesystem
separate from anything the host needs to keep running.

---

## 3. The Docker socket mount is the biggest risk in the system

`docker-compose.yml` mounts `/var/run/docker.sock` into the server container.
Required — the runner has to create containers — and the single most dangerous
thing in this repo.

**Access to the Docker socket is root-equivalent access to the host.** Anyone who
can talk to it can start a container with `Privileged: true` and `/` bind-mounted,
and read or write any file on the host. The container boundary around the API
process is, for this purpose, decorative.

Concretely: an RCE in the Express app — a dependency compromise, a deserialization
bug, anything — escalates directly to host root. **The socket mount converts any
API-process RCE into full host compromise.**

Mitigations that would actually help, in increasing order of effectiveness:

1. A **socket proxy** ([tecnativa/docker-socket-proxy]) allowlisting only
   `POST /containers/create|start|wait|kill`, `DELETE /containers/{id}`, and
   `GET /containers/json` — no `exec`, no `privileged`, no image mutation.
2. **Rootless Docker** or **Podman**, so the daemon is not root to begin with.
3. **Split the runner into its own service** with the socket, leaving the
   public-facing API process without it. This is the highest-value change and is
   why all runner code is isolated under `src/agent-runner/` — it can be lifted
   into a separate process without touching the editor.

None of these are implemented here. The socket is mounted directly, and this
section exists so that is a known decision rather than a discovered surprise.

---

## 4. The real production path: gVisor and Firecracker

Both remove the shared-kernel assumption that section 1 depends on.

### gVisor (`runsc`)

A user-space kernel. It intercepts syscalls and services most of them in a Go
process rather than passing them to the host, so the host kernel surface reachable
from the sandbox shrinks from ~350 syscalls to a small, audited set.

- **Adoption:** one flag — `--runtime=runsc` in `HostConfig`. Nothing else in
  `executor.js` changes.
- **Cost:** roughly 10–30% syscall-heavy overhead; some `ptrace`/`io_uring`
  behaviour is unsupported. Irrelevant for the workloads here.
- **Verdict: this is the change to make first.** Nearly all of the benefit,
  nearly none of the work.

### Firecracker microVMs

A real VM with its own guest kernel, on a minimal VMM (~50k lines vs QEMU's
~1.4M). Hardware-virtualization boundary, not a namespace one — this is what AWS
Lambda and Fargate actually use to run untrusted tenant code.

- **Isolation:** strongest available. An escape needs a hypervisor bug, a far
  rarer and more valuable class than kernel LPEs.
- **Cost:** ~125 ms boot, ~5 MB memory overhead, needs KVM (bare metal or
  nested virtualization), and a different orchestration path than dockerode.

### Cold start vs. warm pool

The tradeoff that decides which you can afford:

| | Cold start | Warm pool |
| --- | --- | --- |
| **Latency** | Docker ~150–400 ms; gVisor ~250–500 ms; Firecracker ~125 ms boot + rootfs | Single-digit ms — the sandbox already exists |
| **Isolation** | **Perfect.** Fresh kernel/filesystem state per run; nothing can leak between runs because nothing is reused | **Weaker by construction.** Reuse is the whole point, and reuse is exactly what cross-run contamination needs |
| **Cost** | Pay per run | Pay to keep idle sandboxes resident |

The failure mode of a warm pool is specific and worth naming: run N leaves state
behind — a file in `/tmp`, a mutated env var, a background process that outlived
its request, a poisoned module cache — and run N+1 inherits it. Now results are
not reproducible, and worse, one tenant's data can reach another's execution. Any
warm pool needs an explicit reset protocol, and *proving* a reset is complete is
substantially harder than starting fresh.

**This system chooses cold start**, and should: runs are triggered by webhooks and
cron, not by a user waiting on a page. A few hundred milliseconds is invisible
here, and per-run isolation is free in a way it never is under interactive
latency budgets. Warm pools earn their risk only when a human is watching a
spinner.

Firecracker's ~125 ms boot is what makes "cold start always" viable at Lambda's
scale — it is fast enough that the warm-pool tradeoff mostly stops being
necessary.

---

## 5. Other controls

**Webhook authentication.** HMAC-SHA256 over the *exact* request bytes, with the
timestamp inside the signed material, a freshness window, and timing-safe
comparison (both sides hashed to a fixed length first, so no length oracle).

The webhook requires `Content-Type: application/agent-runner+json`. This is a
security requirement, not a style choice: the app mounts `express.json()`
globally, which consumes the request stream, and a signature verified against a
*re-serialised* body is not a signature — key order, whitespace and unicode
escaping all differ, so it would accept payloads the sender never signed.
Requests arriving as `application/json` are rejected with 415 rather than
verified weakly.

**Replay protection.** Three layers: a Redis idempotency claim, a unique partial
index on `AgentRun.idempotencyKey` (the actual correctness guarantee if two
deliveries race), and BullMQ job-id de-duplication.

**Quota.** A model with a retry loop and an API key is a way to spend money
quickly. Four independent limits: a 6/min token bucket, worker concurrency of 1,
a 6-call per-run budget terminating as `budget_exceeded` with no retry, and a
200-call daily cap in Redis. Every call is logged with model, tokens and runId so
consumption is auditable.

**No model fallback chain.** The model is pinned. A fallback chain that escalates
on 429 can drain the daily allowance through a tier nobody selected, and a budget
counting *calls* cannot detect it. On 404 — or on a 429 reporting `limit: 0`,
which means no allocation exists and no amount of backoff will help — the run
fails loudly instead of substituting.

**Command injection.** Generated code reaches the container base64-encoded inside
the `Cmd`, whose alphabet is shell-safe by construction. Filenames are
whitelisted rather than escaped.

---

## 6. Summary

| Risk | Status |
| --- | --- |
| Model writes buggy/runaway code | **Handled** — limits, timeout, output cap, cleanup |
| Model code exfiltrates data | **Handled** — no network interface exists |
| Model code persists on the host | **Bounded** — read-only rootfs; the per-run artifact mount is the one exception |
| Model code escapes via kernel exploit | **Not handled** — needs gVisor or Firecracker |
| API-process RCE escalates to host root | **Not handled** — inherent to the Docker socket mount |
| Runaway API spend | **Handled** — four independent quota limits |
| Webhook forgery / replay | **Handled** — raw-body HMAC + three replay layers |

Deploy this behind `AGENT_RUNNER_ENABLED=false` unless you have read section 3
and accepted it.

[tecnativa/docker-socket-proxy]: https://github.com/Tecnativa/docker-socket-proxy
