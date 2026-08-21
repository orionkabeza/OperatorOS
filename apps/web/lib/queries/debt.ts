import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSegment,
  getChaseQueue,
  getDebtBookHeader,
  getReminderDigest,
  getReminderSchedule,
  listBroadcasts,
  listContactLog,
  listDebtAccounts,
  listInvoices,
  listSegments,
  listStatement,
  logContact,
  sendBroadcast,
  sendReminders,
  snoozeCustomer,
  takePayment,
  updateReminderSchedule,
  updateReminderStep,
  writeOffDebt,
} from "../api/debt";
import type { CustomerSegmentFilterSpec, ReminderSchedule, ReminderScheduleStep, TakePaymentInput, WriteOffInput } from "../api/types";

export function useDebtBookHeader() {
  return useQuery({ queryKey: ["debt-header"], queryFn: getDebtBookHeader });
}

export function useDebtAccounts() {
  return useQuery({ queryKey: ["debt-accounts"], queryFn: listDebtAccounts });
}

export function useInvoices(customerId: string | null) {
  return useQuery({ queryKey: ["invoices", customerId], queryFn: () => listInvoices(customerId as string), enabled: Boolean(customerId) });
}

export function useStatement(customerId: string | null) {
  return useQuery({ queryKey: ["statement", customerId], queryFn: () => listStatement(customerId as string), enabled: Boolean(customerId) });
}

export function useContactLog(customerId: string | null) {
  return useQuery({ queryKey: ["contact-log", customerId], queryFn: () => listContactLog(customerId as string), enabled: Boolean(customerId) });
}

function invalidateAccountQueries(queryClient: ReturnType<typeof useQueryClient>, customerId: string) {
  void queryClient.invalidateQueries({ queryKey: ["debt-header"] });
  void queryClient.invalidateQueries({ queryKey: ["debt-accounts"] });
  void queryClient.invalidateQueries({ queryKey: ["invoices", customerId] });
  void queryClient.invalidateQueries({ queryKey: ["statement", customerId] });
  void queryClient.invalidateQueries({ queryKey: ["customers"] });
  void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
  void queryClient.invalidateQueries({ queryKey: ["chase-queue"] });
  void queryClient.invalidateQueries({ queryKey: ["money-locations"] });
  void queryClient.invalidateQueries({ queryKey: ["money-movements"] });
}

export function useTakePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TakePaymentInput) => takePayment(input),
    onSuccess: (_result, input) => invalidateAccountQueries(queryClient, input.customerId),
  });
}

export function useLogContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; note: string }) => logContact(args.customerId, args.note),
    onSuccess: (_result, args) => void queryClient.invalidateQueries({ queryKey: ["contact-log", args.customerId] }),
  });
}

export function useWriteOffDebt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WriteOffInput) => writeOffDebt(input),
    onSuccess: (_result, input) => invalidateAccountQueries(queryClient, input.customerId),
  });
}

export function useChaseQueue() {
  return useQuery({ queryKey: ["chase-queue"], queryFn: getChaseQueue });
}

export function useSnoozeCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { customerId: string; untilIso: string }) => snoozeCustomer(args.customerId, args.untilIso),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["chase-queue"] }),
  });
}

// --- Reminder schedule --------------------------------------------------

export function useReminderSchedule() {
  return useQuery({ queryKey: ["reminder-schedule"], queryFn: getReminderSchedule });
}

export function useUpdateReminderSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<ReminderSchedule, "steps">>) => updateReminderSchedule(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["reminder-schedule"] }),
  });
}

export function useUpdateReminderStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { stepId: string; patch: Partial<ReminderScheduleStep> }) => updateReminderStep(args.stepId, args.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reminder-schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["reminder-digest"] });
    },
  });
}

export function useReminderDigest() {
  return useQuery({ queryKey: ["reminder-digest"], queryFn: getReminderDigest });
}

export function useSendReminders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (customerIds: string[]) => sendReminders(customerIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reminder-digest"] });
      void queryClient.invalidateQueries({ queryKey: ["chase-queue"] });
    },
  });
}

// --- Segments / broadcast --------------------------------------------------

export function useSegments() {
  return useQuery({ queryKey: ["segments"], queryFn: listSegments });
}

export function useCreateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { name: string; filterSpec: CustomerSegmentFilterSpec }) => createSegment(args.name, args.filterSpec),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["segments"] }),
  });
}

export function useBroadcasts() {
  return useQuery({ queryKey: ["broadcasts"], queryFn: listBroadcasts });
}

export function useSendBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { segmentId: string | null; message: string }) => sendBroadcast(args.segmentId, args.message),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["broadcasts"] }),
  });
}
