import DefaultSearchDialog from "fumadocs-ui/components/dialog/search-default";

/**
 * Search over the developer pages.
 *
 * The index is a static file (`/api/search.json`) built at deploy time, so the site needs no search
 * service and a preview deploys with the same answers. The handbook has its own sidebar and its own
 * search inside the app.
 */
export default function SearchDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <DefaultSearchDialog api="/api/search.json" {...props} />;
}
