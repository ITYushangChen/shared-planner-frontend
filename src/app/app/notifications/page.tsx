import { BackToAppButton } from "../back-to-app-button";
import { NotificationsPanel } from "../notifications-panel";

export default function NotificationsPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div>
        <BackToAppButton />
      </div>
      <NotificationsPanel />
    </main>
  );
}
