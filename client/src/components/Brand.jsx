export default function Brand({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display text-lg font-bold ${className}`}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-sky" />
      Event Check-in
    </span>
  );
}
