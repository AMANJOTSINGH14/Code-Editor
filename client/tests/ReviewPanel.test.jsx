import React from "react";
import { render, screen } from "@testing-library/react";
import ReviewPanel from "../src/components/ReviewPanel.jsx";

vi.mock("../src/hooks/useReview.js", () => ({
  useReview: () => ({
    reviewText: "Review output",
    loading: false,
    notice: "",
    startReview: vi.fn()
  })
}));

test("renders review output", () => {
  render(<ReviewPanel documentId="doc" />);
  expect(screen.getByText("Review output")).toBeInTheDocument();
});
