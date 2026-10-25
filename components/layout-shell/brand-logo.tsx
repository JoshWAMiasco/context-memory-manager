import { joinClassNames } from "@/utilities/join-class-names";
import Link from "next/link";
import { CcmLogoMark } from "@/components/icons/ccm-logo-mark";
import { THEME_IDENTITY } from "@/configuration/theme-identity";

export interface BrandLogoClassNames {
  brandLink: string;
  brandMark: string;
  brandName: string;
}

/**
 * CCM's logo mark (`CcmLogoMark`) and the product name. The
 * theme decides where it sits and how it looks (`SHELL_APPEARANCE.classNames`); pass `brandName`
 * to show another name.
 *
 * @example
 * <BrandLogo href="/dashboards/ecommerce" classNames={SHELL_APPEARANCE.classNames} />
 * <BrandLogo href="/" brandName="ACME ADMIN" classNames={SHELL_APPEARANCE.classNames} />
 */
export function BrandLogo({
  href = "/",
  brandName = THEME_IDENTITY.themeDisplayName.toUpperCase(),
  classNames,
}: {
  href?: string;
  brandName?: string;
  classNames: BrandLogoClassNames;
}) {
  return (
    <Link href={href} aria-label={`${brandName} home`} className={joinClassNames(classNames.brandLink)}>
      <CcmLogoMark className={classNames.brandMark} />
      <div className={classNames.brandName}>{brandName}</div>
    </Link>
  );
}
