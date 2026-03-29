import React from "react";
import { render, screen } from "@testing-library/react";
import CodeEditor from "../src/components/CodeEditor.jsx";

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ onMount }) => {
    if (onMount) {
      onMount({ getModel: () => ({}) });
    }
    return <div data-testid="monaco" />;
  }
}));

vi.mock("y-monaco", () => ({
  MonacoBinding: vi.fn()
}));

test("renders monaco editor", () => {
  render(<CodeEditor documentId="doc" socket={null} user={{ id: "1", name: "User" }} language="javascript" />);
  expect(screen.getByTestId("monaco")).toBeInTheDocument();
});
