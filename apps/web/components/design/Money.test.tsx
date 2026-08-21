import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { minorUnits } from "@operatoros/shared";
import { Money } from "./Money";

describe("Money", () => {
  it("renders whole RWF with thousands separators and no decimals", () => {
    render(<Money amount={minorUnits(1_240_500_00)} />);
    expect(screen.getByText("1,240,500")).toBeInTheDocument();
    expect(screen.getByText("RWF")).toBeInTheDocument();
  });

  it("renders zero plainly, never blank", () => {
    render(<Money amount={minorUnits(0)} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders negative amounts with a leading minus in --out, never parentheses", () => {
    render(<Money amount={minorUnits(-340_000_00)} />);
    const figure = screen.getByText("-340,000");
    expect(figure.textContent).not.toMatch(/[()]/);
    expect(figure.className).toContain("text-out");
  });

  it("renders positive amounts in --ink, not --out", () => {
    render(<Money amount={minorUnits(1_00)} />);
    const figure = screen.getByText("1");
    expect(figure.className).toContain("text-ink");
    expect(figure.className).not.toContain("text-out");
  });

  it("uses tabular-numeral mono formatting", () => {
    render(<Money amount={minorUnits(1_00)} />);
    expect(screen.getByLabelText("RWF 1").className).toContain("font-mono");
  });

  it("uses the dark-surface emphasis variant on a dark surface, not the light one (WCAG AA — Debt Book's dark header band)", () => {
    render(<Money amount={minorUnits(500_00)} surface="dark" emphasis="out" />);
    const figure = screen.getByText("500");
    expect(figure.className).toContain("text-out-dark");
    expect(figure.className).not.toBe("text-out");
  });

  it("uses the dark-surface negative variant on a dark surface", () => {
    render(<Money amount={minorUnits(-500_00)} surface="dark" />);
    const figure = screen.getByText("-500");
    expect(figure.className).toContain("text-out-dark");
  });

  it("still uses the plain light emphasis variant on the default light surface", () => {
    render(<Money amount={minorUnits(500_00)} emphasis="out" />);
    const figure = screen.getByText("500");
    expect(figure.className).toContain("text-out");
    expect(figure.className).not.toContain("text-out-dark");
  });
});
