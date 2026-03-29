import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

/**
 * Login page.
 * @returns {JSX.Element} Login page.
 */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Submit login form.
   * @param {React.FormEvent} event - Form event.
   * @returns {Promise<void>} Resolves when complete.
   */
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
      navigate("/dashboard");
    } catch (err) {
      const msg = err?.response?.data?.error?.message || "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md animate-glow-in rounded-3xl border border-slate-800 bg-slate-950/80 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold text-slate-100">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-400">Log in to continue collaborating.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400/60 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400/60 focus:outline-none"
          />
          {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-sky-400/90 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-xs text-slate-400">
          New here?{" "}
          <Link to="/register" className="text-sky-300 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
