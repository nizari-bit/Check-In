export default function Modal({ title, onClose, children, wide, extraWide, mobileFullScreen }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className={`w-full bg-white shadow-xl ${mobileFullScreen
          ? 'flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-none pb-[env(safe-area-inset-bottom)] sm:h-auto sm:max-h-[92vh] sm:rounded-lg sm:pb-5'
          : 'max-h-[92vh] overflow-y-auto rounded-t-2xl p-5 sm:rounded-lg'} ${mobileFullScreen ? 'px-0 pt-0 sm:px-5 sm:pt-5' : ''} ${extraWide ? 'sm:max-w-5xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className={`mb-4 flex shrink-0 items-start justify-between gap-4 ${mobileFullScreen ? 'border-b border-mist px-4 pt-4 sm:border-0 sm:px-0 sm:pt-0' : ''}`}>
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-2xl leading-none text-steel/60 hover:text-ink"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
        {mobileFullScreen
          ? <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:overflow-visible sm:px-0 sm:pb-0">{children}</div>
          : children}
      </div>
    </div>
  );
}
