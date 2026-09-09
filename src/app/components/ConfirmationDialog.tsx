import type { ReactNode } from "react";

export interface ConfirmationConfig {
  title: string;
  message: string;
  confirmLabel: string;
  dangerous?: boolean;
  verificationText?: string;
  action: () => Promise<unknown>;
}

interface ConfirmationDialogProps {
  confirmation: ConfirmationConfig;
  confirmationInput: string;
  confirmationBusy: boolean;
  onInputChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  confirmation,
  confirmationInput,
  confirmationBusy,
  onInputChange,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm p-4 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2
          id="confirm-dialog-title"
          className="text-lg font-bold text-[#1e3a5f]"
        >
          {confirmation.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          {confirmation.message}
        </p>
        {confirmation.verificationText && (
          <div className="mt-4">
            <label className="text-xs font-semibold text-gray-600">
              Type{" "}
              <span className="font-mono text-red-600">
                {confirmation.verificationText}
              </span>{" "}
              to continue
            </label>
            <input
              autoFocus
              value={confirmationInput}
              onChange={(event) => onInputChange(event.target.value)}
              className="mt-1 w-full rounded-xl border border-red-200 px-3 py-2.5 font-mono outline-none focus:ring-2 focus:ring-red-200"
            />
          </div>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onCancel}
            disabled={confirmationBusy}
            className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
          >
            Go back
          </button>
          <button
            onClick={onConfirm}
            disabled={
              confirmationBusy ||
              Boolean(
                confirmation.verificationText &&
                  confirmationInput !== confirmation.verificationText
              )
            }
            className={`rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${
              confirmation.dangerous ? "bg-red-600" : "bg-[#1e3a5f]"
            }`}
          >
            {confirmationBusy ? "Working…" : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
