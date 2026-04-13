import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pager } from "@/components/Pager";

describe("Pager", () => {
  const defaults = {
    page: 0,
    maxPage: 9,
    total: 500,
    pageSize: 50,
    loading: false,
    onPageChange: vi.fn(),
  };

  it("renders showing text", () => {
    render(<Pager {...defaults} />);
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
  });

  it("shows correct range for page 0", () => {
    render(<Pager {...defaults} />);
    expect(screen.getByText(/1–50/)).toBeInTheDocument();
  });

  it("disables prev on first page", () => {
    render(<Pager {...defaults} page={0} />);
    // First page and previous buttons should be disabled
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toBeDisabled(); // <<
    expect(buttons[1]).toBeDisabled(); // <
  });

  it("disables next on last page", () => {
    render(<Pager {...defaults} page={9} />);
    const buttons = screen.getAllByRole("button");
    const lastIdx = buttons.length - 1;
    expect(buttons[lastIdx]).toBeDisabled(); // >>
    expect(buttons[lastIdx - 1]).toBeDisabled(); // >
  });

  it("calls onPageChange when page button clicked", () => {
    const fn = vi.fn();
    render(<Pager {...defaults} onPageChange={fn} />);
    // Click page 2 button
    const btn = screen.getByText("2");
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledWith(1); // 0-indexed
  });

  it("handles loading state gracefully", () => {
    const { container } = render(<Pager {...defaults} loading />);
    // Pager should still render without crashing when loading
    expect(container.querySelector("div")).toBeTruthy();
  });
});
