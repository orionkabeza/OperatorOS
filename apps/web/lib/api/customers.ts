import { minorUnits } from "@operatoros/shared";
import { getDb, mockDelay } from "../mock/store";
import { apiRequest, USE_MOCK_API } from "./config";
import type { CreateCustomerInput, Customer } from "./types";

export async function listCustomers(search?: string): Promise<Customer[]> {
  if (USE_MOCK_API) {
    const rows = getDb().customers.filter((c) => c.id !== "cust-walkin");
    const filtered = search
      ? rows.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
      : rows;
    return mockDelay(filtered);
  }
  return apiRequest<Customer[]>("GET", "/api/v1/customers", { query: { search } });
}

export async function getCustomer(id: string): Promise<Customer> {
  if (USE_MOCK_API) {
    const customer = getDb().customers.find((c) => c.id === id);
    if (!customer) throw new Error(`Customer ${id} not found`);
    return mockDelay(customer);
  }
  return apiRequest<Customer>("GET", `/api/v1/customers/${id}`);
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  if (USE_MOCK_API) {
    const customer: Customer = {
      id: `cust-${crypto.randomUUID()}`,
      name: input.name,
      phone: input.phone,
      creditLimitMinor: input.creditLimitMinor ?? minorUnits(0),
      balanceMinor: minorUnits(0),
      termsDays: input.termsDays ?? 30,
      onHold: false,
    };
    getDb().customers.push(customer);
    return mockDelay(customer);
  }
  return apiRequest<Customer>("POST", "/api/v1/customers", { body: input });
}
