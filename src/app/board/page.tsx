import { redirect } from "next/navigation";

// R3.5 moved the primary surface to "/". This stub keeps existing bookmarks
// and connector OAuth callbacks working while the new homepage is the only
// board view.
export default function BoardRedirect() {
  redirect("/");
}
