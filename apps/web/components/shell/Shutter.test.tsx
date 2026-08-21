import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shutter reads USE_MOCK_API at module scope (it's derived from an env var
// at build time), and the business-slug field only exists on the real-API
// branch -- so the whole point of these tests is unreachable without
// forcing that constant.
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  USE_MOCK_API: false,
}));

const { Shutter } = await import("./Shutter");
const { useAuthStore } = await import("@/lib/auth-store");

const BUSINESS_SLUG_KEY = "operatoros_last_business_slug";

describe("Shutter — business slug field", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      businessSlug: "",
      rememberedSlug: "",
      signedIn: false,
      shutterState: "idle",
    });
  });

  // The regression this file exists for: the field's render condition was
  // `businessSlug ? null : <field/>`, so the first keystroke made the value
  // truthy and unmounted the input mid-type, stranding a one-character slug
  // that then failed login as "that PIN doesn't match this number".
  it("stays mounted while the user types into it", () => {
    render(<Shutter />);
    const field = screen.getByLabelText("Business");

    fireEvent.change(field, { target: { value: "d" } });
    expect(screen.getByLabelText("Business")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Business"), { target: { value: "demo-703186" } });
    expect(screen.getByLabelText("Business")).toHaveValue("demo-703186");
  });

  it("does not render partially-typed input as the business name", () => {
    render(<Shutter />);
    expect(screen.getByText("OperatorOS")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Business"), { target: { value: "d" } });

    // Would have read "D" when the backdrop was driven off the live value.
    expect(screen.getByText("OperatorOS")).toBeInTheDocument();
    expect(screen.queryByText("D")).not.toBeInTheDocument();
  });

  // A remembered slug that's wrong (renamed business, typo saved on a first
  // sign-in) must stay correctable -- hiding the field on any remembered
  // value made every subsequent attempt fail with a PIN error and no way to
  // fix the actual cause.
  it("prefills a remembered slug but keeps it editable", () => {
    window.localStorage.setItem(BUSINESS_SLUG_KEY, "demo-703186");
    render(<Shutter />);

    const field = screen.getByLabelText("Business");
    expect(field).toHaveValue("demo-703186");

    fireEvent.change(field, { target: { value: "other-shop" } });
    expect(screen.getByLabelText("Business")).toHaveValue("other-shop");
  });

  it("shows the remembered business as the backdrop name", () => {
    window.localStorage.setItem(BUSINESS_SLUG_KEY, "kigali-hardware");
    render(<Shutter />);
    expect(screen.getByText("Kigali Hardware")).toBeInTheDocument();
  });
});
