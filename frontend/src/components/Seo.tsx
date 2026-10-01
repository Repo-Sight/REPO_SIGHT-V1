import { Head } from "vite-react-ssg";
import { SITE } from "../site";

interface SeoProps {
  title: string;
  description: string;
  /** Absolute canonical URL. Omit only for pages that must not have one (404). */
  canonical?: string | null;
  robots?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  /** schema.org JSON-LD, serialised into the prerendered HTML. */
  jsonLd?: Record<string, unknown> | null;
}

export function Seo({
  title,
  description,
  canonical,
  robots,
  ogTitle,
  ogDescription,
  jsonLd,
}: SeoProps) {
  const ogT = ogTitle ?? title;
  const ogD = ogDescription ?? description;
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      {canonical ? <link rel="canonical" href={canonical} /> : null}
      <meta name="robots" content={robots ?? "index, follow"} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE.name} />
      <meta property="og:title" content={ogT} />
      <meta property="og:description" content={ogD} />
      {canonical ? <meta property="og:url" content={canonical} /> : null}
      <meta property="og:image" content={SITE.ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={ogT} />
      <meta name="twitter:description" content={ogD} />
      <meta name="twitter:image" content={SITE.ogImage} />

      {jsonLd ? <script type="application/ld+json">{JSON.stringify(jsonLd)}</script> : null}
    </Head>
  );
}
