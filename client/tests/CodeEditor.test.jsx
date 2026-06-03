import React from "react";
import { render, screen } from "@testing-library/react";
import CodeEditor from "../src/components/CodeEditor.jsx";

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ onMount }) => {
    if (onMount) {
      onMount({
        getModel: () => ({}),
        deltaDecorations: jest.fn(() => []),
        getOption: jest.fn(),
        updateOptions: jest.fn()
      });
    }
    return <div data-testid="monaco" />;
  }
}));

jest.mock("y-monaco", () => ({
  MonacoBinding: jest.fn()
}));

test("renders monaco editor", () => {
  render(<CodeEditor documentId="doc" socket={null} user={{ id: "1", name: "User" }} language="javascript" />);
  expect(screen.getByTestId("monaco")).toBeInTheDocument();
});
