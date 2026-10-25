import type { ReactNode } from "react";
import { CmmLogoMark } from "@/components/icons/cmm-logo-mark";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface AuthenticationFrameProps {
  title: ReactNode;
  prompt?: ReactNode;
  notice?: ReactNode;
  headline?: ReactNode;
  pitch?: ReactNode;
  communityCaption?: ReactNode;
  className?: string;
  children: ReactNode;
}

function AuthenticationLogoMark() {
  return <CmmLogoMark className="h-[56px] w-[56px]" />;
}

/**
 * The split-screen frame shared by the sign-in and sign-up pages: a form column on the left and a
 * pitch panel on the right (hidden below `lg`) drawn by the theme's `decoration-hero-backdrop`. Put the form in `children`.
 *
 * @example
 * <AuthenticationFrame
 *   title="Sign In"
 *   prompt={<>Don't have an account? <Link href="/register" className="font-medium text-primary">Sign Up</Link></>}
 * >
 *   <SignInForm />
 * </AuthenticationFrame>
 */
export function AuthenticationFrame({
  title,
  prompt,
  notice,
  headline = (
    <>
      Your context,
      <br />
      kept private
    </>
  ),
  pitch = "CMM keeps the memory folders, prompts and training data of your LLM tools on your own machine or homelab: encrypted, versioned and backed up, with no cloud in between.",
  communityCaption = "Runs fully offline.",
  className,
  children,
}: AuthenticationFrameProps) {
  return (
    <>
      <div
        className={mergeClassNames(
          "container grid grid-cols-12 px-5 py-10 sm:px-10 sm:py-14 md:px-36 lg:h-screen lg:max-w-[1550px] lg:py-0 lg:pr-12 lg:pl-14 xl:px-24 2xl:max-w-[1750px]",
          className,
        )}
      >
        <div className="relative z-50 col-span-12 h-full rounded-2xl bg-surface p-7 before:absolute before:inset-0 before:mx-5 before:-mb-3.5 before:rounded-2xl before:bg-on-primary/40 before:content-[''] sm:p-14 lg:col-span-5 lg:bg-transparent lg:p-0 lg:pr-10 xl:pr-24 2xl:col-span-4">
          <div className="relative z-10 flex h-full w-full flex-col justify-center py-2 lg:py-32">
            <AuthenticationLogoMark />
            <div className="mt-10">
              <h1 className="font-display text-2xl font-medium">{title}</h1>
              {prompt && <div className="mt-2.5 text-foreground">{prompt}</div>}
              {notice}
              <div className="mt-6">{children}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="fixed inset-0 container grid h-screen w-screen grid-cols-12 pr-12 pl-14 lg:max-w-[1550px] xl:px-24 2xl:max-w-[1750px]">
        <div className="relative z-20 col-span-12 h-screen before:absolute before:inset-y-0 before:right-0 before:my-6 before:-mr-4 before:hidden before:w-[800%] before:rounded-r-box before:bg-on-primary/50 before:bg-linear-to-b before:from-on-primary/10 before:to-surface-subtle/10 before:content-[''] after:absolute after:inset-y-0 after:right-0 after:hidden after:w-[800%] after:rounded-r-box after:bg-surface after:bg-linear-to-b after:from-surface after:to-surface-muted/80 after:content-[''] lg:col-span-5 lg:before:block lg:after:block 2xl:col-span-4" />
        <div className="col-span-7 h-full before:absolute before:inset-y-0 before:left-0 before:w-screen before:decoration-hero-backdrop before:content-[''] lg:relative lg:before:-ml-10 lg:before:w-[800%] 2xl:col-span-8">
          <div className="sticky top-0 z-10 ml-16 hidden h-screen flex-col justify-center lg:flex xl:ml-28 2xl:ml-36">
            <div className="font-display text-[2.4rem] leading-[1.3] font-semibold text-foreground-strong xl:text-[2.8rem] xl:leading-[1.2]">
              {headline}
            </div>
            <div className="mt-5 text-base leading-relaxed text-foreground-muted xl:text-lg">{pitch}</div>
            <div className="mt-10 flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="text-base text-foreground-muted">{communityCaption}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
