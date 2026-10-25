import { SettingsNavigation } from "@/components/page-sections/settings/settings-navigation";
import { listSettingsNavigationItems } from "@/components/page-sections/settings/settings-navigation-items";
import { PageHeader } from "@/components/primitives/page-header";
import { requirePageSession } from "@/server/auth/page-guard";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const authContext = await requirePageSession();
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-10">
      <div className="col-span-12">
        <PageHeader title={<h1>Settings</h1>} />
        <div className="mt-3.5 grid grid-cols-12 gap-x-6 gap-y-10">
          <div className="relative col-span-12 xl:col-span-3">
            <SettingsNavigation
              items={listSettingsNavigationItems(authContext.user.role)}
              className="sticky top-[104px]"
            />
          </div>
          <div className="col-span-12 flex flex-col gap-y-7 xl:col-span-9">{children}</div>
        </div>
      </div>
    </div>
  );
}
