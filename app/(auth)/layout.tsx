import { ToastViewport } from "@/components/interactive/toast-notification";

export default function AuthenticationLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {children}
      <ToastViewport />
    </>
  );
}
