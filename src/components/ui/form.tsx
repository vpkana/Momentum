import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[13px] font-medium leading-none text-foreground/90",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-3">
          {label ? <Label htmlFor={htmlFor}>{label}</Label> : <span />}
          {hint ? (
            <span className="text-xs text-muted-foreground">{hint}</span>
          ) : null}
        </div>
      )}
      {children}
    </div>
  );
}

const fieldBase =
  "w-full min-w-0 rounded-lg border border-input bg-card text-foreground placeholder:text-muted-foreground/70 " +
  "transition-[border-color,box-shadow,background-color] duration-150 " +
  "focus:outline-none focus:ring-2 focus:ring-ring/60 focus:border-ring/60 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(fieldBase, "h-9 px-3 text-sm", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldBase, "min-h-[84px] resize-y px-3 py-2 text-sm leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          fieldBase,
          "h-9 cursor-pointer appearance-none pl-3 pr-9 text-sm",
          // Neutral chevron that reads on both surfaces.
          "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2216%22%20height=%2216%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%23666666%22%20stroke-width=%222.5%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%3E%3Cpath%20d=%22m6%209%206%206%206-6%22/%3E%3C/svg%3E')] bg-[right_0.65rem_center] bg-no-repeat",
          // Theme-compliant popup: `color-scheme` makes Chromium (web +
          // Android WebView) render the native option list on the current
          // theme's surface — light in light mode, dark in dark mode, with
          // no white flash. Token-based option colors cover the rest.
          "[color-scheme:light] dark:[color-scheme:dark]",
          "[&>option]:bg-background [&>option]:text-foreground [&>option]:text-[13px]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
