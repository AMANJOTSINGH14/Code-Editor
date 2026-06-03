import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ReviewPanel from "../src/components/ReviewPanel.jsx";

const mockStartReview = jest.fn();
const mockStopReview = jest.fn();
const mockReset = jest.fn();

let mockState = {
  reviewText: "",
  loading: false,
  notice: "",
  error: "",
  startReview: mockStartReview,
  stopReview: mockStopReview,
  reset: mockReset
};

jest.mock("../src/hooks/useReview.js", () => ({
  useReview: () => mockState
}));

beforeEach(() => {
  mockState = {
    reviewText: "",
    loading: false,
    notice: "",
    error: "",
    startReview: mockStartReview,
    stopReview: mockStopReview,
    reset: mockReset
  };
  jest.clearAllMocks();
});

describe("ReviewPanel", () => {
  test("renders initial empty state with CTA message", () => {
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText(/Click.*Review My Code/)).toBeInTheDocument();
  });

  test("renders Review My Code button", () => {
    render(<ReviewPanel documentId="doc1" />);
    const btn = screen.getByText("Review My Code");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  test("calls startReview with documentId on button click", () => {
    render(<ReviewPanel documentId="doc123" />);
    fireEvent.click(screen.getByText("Review My Code"));
    expect(mockStartReview).toHaveBeenCalledWith("doc123");
  });

  test("shows loading spinner when loading with no text yet", () => {
    mockState.loading = true;
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Streaming review...")).toBeInTheDocument();
  });

  test("shows Reviewing... text on button when loading", () => {
    mockState.loading = true;
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Reviewing...")).toBeInTheDocument();
  });

  test("disables review button while loading", () => {
    mockState.loading = true;
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Reviewing...")).toBeDisabled();
  });

  test("shows Stop button when loading", () => {
    mockState.loading = true;
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
  });

  test("Stop button calls stopReview", () => {
    mockState.loading = true;
    render(<ReviewPanel documentId="doc1" />);
    fireEvent.click(screen.getByText("Stop"));
    expect(mockStopReview).toHaveBeenCalled();
  });

  test("hides Stop button when not loading", () => {
    mockState.loading = false;
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
  });

  test("displays review text when available", () => {
    mockState.reviewText = "## Code Quality\n- Variable naming is good\n- Consider adding error handling";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText(/Variable naming is good/)).toBeInTheDocument();
  });

  test("displays review text while still loading (streaming)", () => {
    mockState.loading = true;
    mockState.reviewText = "Partial review...";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Partial review...")).toBeInTheDocument();
    // Should NOT show spinner when we have text
    expect(screen.queryByText("Streaming review...")).not.toBeInTheDocument();
  });

  test("displays notice when set", () => {
    mockState.notice = "Large file — reviewing the most relevant section.";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText(/Large file/)).toBeInTheDocument();
  });

  test("does not display notice when empty", () => {
    mockState.notice = "";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.queryByText(/Large file/)).not.toBeInTheDocument();
  });

  test("displays error message", () => {
    mockState.error = "Failed to connect to review service.";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("Failed to connect to review service.")).toBeInTheDocument();
  });

  test("error takes precedence over review text", () => {
    mockState.error = "API error";
    mockState.reviewText = "Some old review text";
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("API error")).toBeInTheDocument();
    expect(screen.queryByText("Some old review text")).not.toBeInTheDocument();
  });

  test("renders AI Review heading", () => {
    render(<ReviewPanel documentId="doc1" />);
    expect(screen.getByText("AI Review")).toBeInTheDocument();
  });

  test("review text preserves whitespace (pre-wrap)", () => {
    mockState.reviewText = "Line 1\nLine 2\n  Indented";
    render(<ReviewPanel documentId="doc1" />);
    const el = screen.getByText(/Line 1/);
    expect(el.className).toContain("whitespace-pre-wrap");
  });
});
