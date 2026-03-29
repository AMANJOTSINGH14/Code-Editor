import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import Dashboard from "../src/pages/Dashboard.jsx";
import { AuthProvider } from "../src/context/AuthContext.jsx";
import { BrowserRouter } from "react-router-dom";

vi.mock("../src/services/api.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { data: { documents: [{ id: "1", title: "Doc", language: "js" }] } } }),
    interceptors: { response: { use: vi.fn() } }
  },
  onInterceptorRefresh: vi.fn()
}));

/**
 * Render the dashboard with auth.
 * @returns {void}
 */
function renderWithAuth() {
  render(
    <AuthProvider>
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    </AuthProvider>
  );
}

test("renders document list", async () => {
  localStorage.clear();
  renderWithAuth();
  await waitFor(() => {
    expect(screen.getByText("Doc")).toBeInTheDocument();
  });
});
