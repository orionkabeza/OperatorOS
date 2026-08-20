import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and responds to click", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Record sale</Button>);
    screen.getByText("Record sale").click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disabled buttons carry a title explaining why — spec B.6", () => {
    render(
      <Button disabled disabledReason="Open the shop before selling.">
        Take payment
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Take payment" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Open the shop before selling.");
  });

  it("warns in development when disabled without a reason", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Button disabled>No reason given</Button>);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("primary variant uses the tape fill", () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-tape");
  });

  it("danger variant uses the out fill", () => {
    render(<Button variant="danger">Write off debt</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-out");
  });
});
