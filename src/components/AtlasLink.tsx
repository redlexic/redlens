import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useSearchParams } from "wouter";
import { Link } from "./Link";
import { ROUTES } from "../lib/routes";

// Like <Link>, but when the destination is /atlas, folds ?split= from the
// current URL into the target so the comparison pane persists across atlas-
// internal navigation and across search → atlas navigation. From any other
// route (no split in URL) it is a no-op equivalent to <Link>.
interface Props extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  to: string;
}

export const AtlasLink = forwardRef<HTMLAnchorElement, Props>(function AtlasLink(
  { to, ...rest },
  ref,
) {
  const [params] = useSearchParams();
  const split = params.get("split");
  let finalTo = to;
  if (split && to.startsWith(`${ROUTES.ATLAS}?`)) {
    const [, query = ""] = to.split("?", 2);
    const np = new URLSearchParams(query);
    if (!np.has("split")) np.set("split", split);
    finalTo = `${ROUTES.ATLAS}?${np}`;
  }
  return <Link ref={ref} to={finalTo} {...rest} />;
});
