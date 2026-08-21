import { describe, expect, it } from "vitest";
import { fieldsReferencedBy, renderTemplate } from "./template-merge";

describe("renderTemplate", () => {
  it("substitutes every field present in the input", () => {
    const result = renderTemplate("Muraho {customer}, RWF {amount} is due.", { customer: "Jean Bosco", amount: "45,000" });
    expect(result.text).toBe("Muraho Jean Bosco, RWF 45,000 is due.");
    expect(result.missingFields).toEqual([]);
    expect(result.presentFields.sort()).toEqual(["amount", "customer"]);
  });

  it("leaves a missing field as the literal token, not blank, and reports it as missing", () => {
    const result = renderTemplate("Hi {customer}, your pay link is {pay_link}.", { customer: "Divine" });
    expect(result.text).toBe("Hi Divine, your pay link is {pay_link}.");
    expect(result.missingFields).toEqual(["pay_link"]);
    expect(result.presentFields).toEqual(["customer"]);
  });

  it("handles a template with no merge fields at all", () => {
    const result = renderTemplate("This is a plain reminder with no fields.", {});
    expect(result.text).toBe("This is a plain reminder with no fields.");
    expect(result.missingFields).toEqual([]);
    expect(result.presentFields).toEqual([]);
  });

  it("handles every documented merge field together (customer, amount, days_overdue, oldest_invoice_date, pay_link)", () => {
    const result = renderTemplate(
      "{customer}: RWF {amount} is {days_overdue} days overdue since {oldest_invoice_date}. Pay: {pay_link}",
      {
        customer: "Kigali Builders Ltd",
        amount: "1,760,000",
        days_overdue: "26",
        oldest_invoice_date: "24 Jun",
        pay_link: "https://pay.example/tok123",
      },
    );
    expect(result.text).toBe("Kigali Builders Ltd: RWF 1,760,000 is 26 days overdue since 24 Jun. Pay: https://pay.example/tok123");
    expect(result.missingFields).toEqual([]);
  });

  it("treats an empty-string value the same as missing (never silently renders blank)", () => {
    const result = renderTemplate("Amount: {amount}", { amount: "" });
    expect(result.text).toBe("Amount: {amount}");
    expect(result.missingFields).toEqual(["amount"]);
  });
});

describe("fieldsReferencedBy", () => {
  it("lists the distinct merge fields a template body uses", () => {
    expect(fieldsReferencedBy("{customer} owes {amount}, {amount} total.")).toEqual(["customer", "amount"]);
  });
  it("returns an empty list for a template with no fields", () => {
    expect(fieldsReferencedBy("Plain text.")).toEqual([]);
  });
});
