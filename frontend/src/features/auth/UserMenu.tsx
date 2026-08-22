import { useNavigate } from "react-router";
import { MENU_ITEM, Menu } from "../../components/ui/Menu";
import { useAppSelector } from "../../app/hooks";
import { useLogoutMutation } from "./authApi";
import { selectCurrentUser } from "./authSlice";

/**
 * The header's account menu: who you are, where your account settings are, and
 * sign out.
 *
 * ⚠️ **Sessions is deliberately not an item here.** It is a sub-page of
 * `/profile` and is one click away through that screen's own sub-nav; listing
 * it again in the menu made the menu a second, competing navigation for the
 * same two pages — and the one that would silently fall out of date the moment
 * a third profile sub-page appeared.
 *
 * ⚠️ **Neither is the theme.** It is its own icon button in the header now
 * ([ThemeButton](../theme/ThemeButton.tsx)), because it is not an account
 * setting: it is per browser, not per account, and burying a control people
 * change often two levels deep under their own name is the opposite of what the
 * menu is for. Both menus share [Menu](../../components/ui/Menu.tsx), so the
 * keyboard behaviour cannot diverge between them.
 */

/** The trigger's avatar. Initials, because there is no avatar upload. */
function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-soft-fg"
    >
      {initials || "?"}
    </span>
  );
}

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="size-3 text-fg-faint"
    >
      <path d="m4 6.25 4 4 4-4" />
    </svg>
  );
}

export function UserMenu() {
  const user = useAppSelector(selectCurrentUser);
  const [logout, { isLoading: isSigningOut }] = useLogoutMutation();
  const navigate = useNavigate();

  return (
    <Menu
      label="Account"
      trigger={
        <>
          <Initials name={user?.name ?? ""} />
          <ChevronDown />
        </>
      }
    >
      {(close) => (
        <>
          {/* Not a menu item: it is a label, and arrowing onto something you
              cannot activate is a dead stop in the middle of the list. */}
          <div className="px-3 pt-1 pb-2">
            <p className="truncate text-sm font-medium text-fg">{user?.name}</p>
            <p className="truncate text-xs text-fg-subtle">{user?.email}</p>
          </div>

          <div className="border-t border-line-subtle py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close(false);
                void navigate("/profile");
              }}
              className={MENU_ITEM}
            >
              Profile
            </button>
          </div>

          <div className="border-t border-line-subtle py-1">
            {/* No navigate() needed: `loggedOut` flips `isAuthenticated` and
                RequireAuth redirects on the next render. */}
            <button
              type="button"
              role="menuitem"
              disabled={isSigningOut}
              onClick={() => {
                close(false);
                void logout();
              }}
              className={`${MENU_ITEM} hover:bg-danger-soft focus-visible:bg-danger-soft disabled:opacity-50`}
              style={{ color: "red" }}
            >
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </Menu>
  );
}
