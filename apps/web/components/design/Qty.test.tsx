import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Qty } from "./Qty";

describe("Qty", () => {
  it("formats with thousands separators", () => {
    render(<Qty value={1240} />);
    expect(screen.getByText(/1,240/)).toBeInTheDocument();
  });

  it("shows the unit when given", () => {
    render(<Qty value={42} unit="bags" />);
    expect(screen.getByText("bags")).toBeInTheDocument();
  });

  it("defaults to the normal (ink) tone", () => {
    const { container } = render(<Qty value={5} />);
    expect(container.firstChild).toHaveClass("text-ink");
  });

  it("uses --watch for the low tone", () => {
    const { container } = render(<Qty value={4} tone="low" />);
    expect(container.firstChild).toHaveClass("text-watch");
  });

  it("uses --out for the zero tone", () => {
    const { container } = render(<Qty value={0} tone="zero" />);
    expect(container.firstChild).toHaveClass("text-out");
  });
});
