import { redirect } from "next/navigation";

/** The site has one collection, so the home page is the docs root. */
export default function Home() {
  redirect("/docs");
}
