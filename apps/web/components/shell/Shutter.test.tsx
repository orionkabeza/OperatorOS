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
      // These cover the sign-in form, which only renders once the session
      // check has come back -- see the "restoring" test below for that gate.
      sessionChecked: true,
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

  // A refresh used to drop a live session outright. Now the session is
  // re-checked against the server first -- and asking a signed-in user for
  // their PIN while that is in flight, only to yank the form away, is worse
  // than making them wait a beat.
  it("holds the sign-in form until the session check comes back", () => {
    // The marker a previous sign-in leaves behind — without it there is
    // nothing to check and the form renders straight away.
    window.localStorage.setItem("operatoros_session_hint", "1");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    useAuthStore.setState({ sessionChecked: false });

    render(<Shutter />);

    expect(screen.getByText("Opening up…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Business")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows the form immediately for a browser that has never signed in", () => {
    useAuthStore.setState({ sessionChecked: false });
    render(<Shutter />);

    expect(screen.getByLabelText("Business")).toBeInTheDocument();
  });
});
