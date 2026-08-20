"use client";

import { useState } from "react";
import { Button } from "@/components/design/Button";
import { Card } from "@/components/design/Card";
import { MERGE_FIELDS, renderTemplate } from "@/lib/template-merge";
import { useReminderDigest, useReminderSchedule, useSendReminders, useUpdateReminderSchedule, useUpdateReminderStep } from "@/lib/queries/debt";
import type { ReminderScheduleStep } from "@/lib/api/types";

const SAMPLE_FIELDS = {
  customer: "Jean Bosco Habimana",
  amount: "1,845,000",
  days_overdue: "62",
  oldest_invoice_date: "24 Jun",
  pay_link: "https://pay.example/demo-pay-kigali",
};

function offsetLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} days before due date`;
  if (days === 0) return "On the due date";
  return `${days} days after due date`;
}

/** D.6.5 — reminder schedule builder with live template preview + the approval-mode daily digest. Code-split from DebtBook.tsx (bundle budget) since this editor is heavier than the everyday accounts view. */
export function ReminderScheduleTab() {
  const { data: schedule } = useReminderSchedule();
  const updateSchedule = useUpdateReminderSchedule();
  const updateStep = useUpdateReminderStep();
  const { data: digest } = useReminderDigest();
  const sendReminders = useSendReminders();
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  // Default state is "every digest item checked" — this set tracks which
  // items the user has explicitly *un*checked, so a newly-arrived digest
  // item starts checked without needing to seed the set from a query result.
  const [uncheckedIds, setUncheckedIds] = useState<Set<string>>(new Set());
  const [draftTemplate, setDraftTemplate] = useState<string | null>(null);

  const selectedStep: ReminderScheduleStep | undefined = schedule?.steps.find((s) => s.id === selectedStepId) ?? schedule?.steps[0];
  const templateText = draftTemplate ?? selectedStep?.template ?? "";
  const preview = renderTemplate(templateText, SAMPLE_FIELDS);

  const digestItems = digest ?? [];
  const allChecked = digestItems.length > 0 && digestItems.every((i) => !uncheckedIds.has(i.id));
  const effectiveChecked = digestItems.filter((i) => !uncheckedIds.has(i.id));

  return (
    <div className="flex flex-col gap-24">
      <Card eyebrow="Reminder engine" title="Schedule settings">
        <div className="flex flex-wrap items-center gap-24">
          <label className="flex items-center gap-8 text-table text-ink">
            <input
              type="checkbox"
              checked={schedule?.approvalMode ?? false}
              onChange={(e) => updateSchedule.mutate({ approvalMode: e.target.checked })}
            />
            Approval mode (review before sending)
          </label>
          <label className="flex items-center gap-8 text-table text-ink">
            <input type="checkbox" checked={schedule?.paused ?? false} onChange={(e) => updateSchedule.mutate({ paused: e.target.checked })} />
            Paused
          </label>
          <span className="text-meta text-ink-soft">
            Quiet hours {schedule?.quietHoursStart}–{schedule?.quietHoursEnd} · max {schedule?.maxPerCustomerPerWeek}/customer/week
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-8">
          {(schedule?.steps ?? []).map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                setSelectedStepId(step.id);
                setDraftTemplate(null);
              }}
              className={`flex flex-col gap-4 rounded border p-12 text-left ${selectedStep?.id === step.id ? "border-tape-deep bg-tape/10" : "border-rule"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-table font-semibold text-ink">
                  {String(step.order).padStart(2, "0")} — {offsetLabel(step.offsetDays)}
                </span>
                <label className="flex items-center gap-4 text-meta text-ink-soft" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={step.enabled} onChange={(e) => updateStep.mutate({ stepId: step.id, patch: { enabled: e.target.checked } })} />
                  Enabled
                </label>
              </div>
              <span className="text-meta text-ink-soft">
                {step.tone} · {step.channels.join(" + ")}
              </span>
            </button>
          ))}
        </div>

        <Card eyebrow="Template" title={selectedStep ? `Step ${selectedStep.order}` : "Template"}>
          {selectedStep ? (
            <div className="flex flex-col gap-12">
              <textarea
                aria-label="Reminder template body"
                value={templateText}
                onChange={(e) => setDraftTemplate(e.target.value)}
                rows={5}
                className="rounded border border-rule bg-paper p-12 font-mono text-table text-ink"
              />
              <div className="flex flex-wrap gap-4">
                {MERGE_FIELDS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDraftTemplate(`${templateText}{${f}}`)}
                    className="rounded border border-rule px-8 py-4 text-micro font-mono text-ink-soft hover:border-steel"
                  >
                    {`{${f}}`}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                disabled={draftTemplate === null}
                disabledReason="No changes to save."
                onClick={() => {
                  if (draftTemplate !== null) updateStep.mutate({ stepId: selectedStep.id, patch: { template: draftTemplate } });
                  setDraftTemplate(null);
                }}
              >
                Save template
              </Button>

              <div className="rounded bg-steel p-16">
                <p className="mb-8 text-micro font-semibold uppercase tracking-tracked text-white/60">Live preview</p>
                <p className="text-body text-white">{preview.text}</p>
                {preview.missingFields.length > 0 ? (
                  <p className="mt-8 text-meta text-watch-dark">Missing sample values for: {preview.missingFields.join(", ")}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-meta text-ink-soft">Select a step to edit its template.</p>
          )}
        </Card>
      </div>

      {schedule?.approvalMode ? (
        <Card eyebrow="Approval-mode digest" title="Today's reminders">
          {digestItems.length === 0 ? (
            <p className="text-meta text-ink-soft">Nothing due to send today.</p>
          ) : (
            <div className="flex flex-col gap-8">
              <label className="flex items-center gap-8 text-table text-ink">
                <input type="checkbox" checked={allChecked} onChange={(e) => setUncheckedIds(e.target.checked ? new Set() : new Set(digestItems.map((i) => i.id)))} />
                Select all
              </label>
              {digestItems.map((item) => {
                const checked = !uncheckedIds.has(item.id);
                return (
                  <label key={item.id} className="flex items-start gap-8 rounded border border-rule p-12">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setUncheckedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      }}
                    />
                    <div>
                      <p className="text-table font-semibold text-ink">
                        {item.customer.name} — Step {item.step.order}
                      </p>
                      <p className="text-meta text-ink-soft">{item.renderedMessage}</p>
                    </div>
                  </label>
                );
              })}
              <Button
                variant="primary"
                disabled={effectiveChecked.length === 0}
                disabledReason="Select at least one reminder to send."
                onClick={() => {
                  sendReminders.mutate(effectiveChecked.map((i) => i.customer.id));
                  setUncheckedIds(new Set(digestItems.map((i) => i.id)));
                }}
              >
                Send {effectiveChecked.length} reminders
              </Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
