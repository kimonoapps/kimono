import { InkLoader } from "@/components/ink-loader";

/* A page that takes a moment shows Kimono's painted morphing shape, only after a quarter second. */
export default function Loading() {
  return <div className="page-loading"><InkLoader /></div>;
}
