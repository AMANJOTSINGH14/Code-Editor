import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VersionHistory from "../src/components/VersionHistory.jsx";

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  DiffEditor: () => <div>Diff Editor</div>
}));

jest.mock("../src/services/api.js", () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: "v1",
              label: "Auto-save #1",
              snapshotText: "old",
              createdAt: new Date().toISOString(),
              isPublished: false
            }
          ]
        }
      }
    }),
    post: jest.fn().mockResolvedValue({ data: { data: {} } })
  }
}));

test("renders version timeline", async () => {
  render(<VersionHistory documentId="doc" currentContent="new" language="javascript" />);
  await waitFor(() => {
    expect(screen.getByText("Auto-save #1")).toBeInTheDocument();
  });
});

test("opens diff viewer on preview", async () => {
  render(<VersionHistory documentId="doc" currentContent="new" language="javascript" />);
  await waitFor(() => {
    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("Preview"));
  expect(screen.getByText("Version Diff")).toBeInTheDocument();
});
