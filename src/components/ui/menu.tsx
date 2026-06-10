'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Menu — a self-contained dropdown. `MenuButton` toggles a popover `MenuItems`
 * panel; it closes on Escape, on outside-click, and after an item is chosen.
 * Roles follow the ARIA menu pattern (`menu` / `menuitem`).
 *
 *   <Menu>
 *     <MenuButton>…</MenuButton>
 *     <MenuItems>
 *       <MenuItem onSelect={…}>Edit</MenuItem>
 *       <MenuItem danger onSelect={…}>Delete</MenuItem>
 *     </MenuItems>
 *   </Menu>
 */
interface MenuCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  buttonId: string;
  menuId: string;
}
const MenuContext = createContext<MenuCtx | null>(null);

function useMenu(component: string): MenuCtx {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error(`<${component}> must be used inside <Menu>`);
  return ctx;
}

export function Menu({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const base = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <MenuContext.Provider
      value={{ open, setOpen, rootRef, buttonId: `${base}-btn`, menuId: `${base}-menu` }}
    >
      <div ref={rootRef} className={cn('relative inline-block', className)} {...rest}>
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export function MenuButton({
  className,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, buttonId, menuId } = useMenu('MenuButton');
  return (
    <button
      type="button"
      id={buttonId}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={(e) => {
        onClick?.(e);
        setOpen(!open);
      }}
      className={cn('focus-ring inline-flex', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface MenuItemsProps extends HTMLAttributes<HTMLDivElement> {
  /** Horizontal alignment of the panel relative to the button. */
  align?: 'start' | 'end';
}

export function MenuItems({ className, children, align = 'start', ...rest }: MenuItemsProps) {
  const { open, menuId, buttonId } = useMenu('MenuItems');
  if (!open) return null;
  return (
    <div
      role="menu"
      id={menuId}
      aria-labelledby={buttonId}
      className={cn(
        'animate-rise absolute z-50 mt-1.5 min-w-[12rem] overflow-hidden rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  onSelect?: () => void;
  danger?: boolean;
  icon?: ReactNode;
}

export function MenuItem({
  className,
  children,
  onSelect,
  danger,
  icon,
  disabled,
  ...rest
}: MenuItemProps) {
  const { setOpen } = useMenu('MenuItem');
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
      className={cn(
        'focus-ring flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left text-sm',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:text-ink-faint',
        danger
          ? 'text-rose hover:bg-rose-tint [&_svg]:text-rose'
          : 'text-ink-soft hover:bg-surface-2 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
