import { SITE } from "../site";

export const NAV = [
  { href: "/#pipeline", label: "How it works" },
  { href: "/#features", label: "What you get" },
  { href: "/learn/", label: "Learn" },
];

export const LANGUAGES = [
  { href: "/cpp-code-analyzer.html", label: "C++" },
  { href: "/python-code-analyzer.html", label: "Python" },
  { href: "/java-code-analyzer.html", label: "Java" },
  { href: "/typescript-code-analyzer.html", label: "TypeScript" },
  { href: "/javascript-code-analyzer.html", label: "JavaScript" },
  { href: "/csharp-code-analyzer.html", label: "C#" },
];

export const FOOTER_COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#analyze", label: "Analyze a repo" },
      { href: "/#pipeline", label: "How it works" },
      { href: "/#features", label: "What you get" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/cpp-code-analyzer.html", label: "C++ analyzer" },
      { href: "/python-code-analyzer.html", label: "Python analyzer" },
      { href: "/java-code-analyzer.html", label: "Java analyzer" },
      { href: "/typescript-code-analyzer.html", label: "TypeScript analyzer" },
      { href: "/javascript-code-analyzer.html", label: "JavaScript analyzer" },
      { href: "/csharp-code-analyzer.html", label: "C# analyzer" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/learn/", label: "Browse all articles" },
      { href: "/learn/what-is-static-analysis.html", label: "What is static analysis?" },
      { href: "/learn/cyclomatic-complexity-explained.html", label: "Cyclomatic complexity" },
      { href: "/learn/reading-a-code-health-score.html", label: "Reading a health score" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/about.html", label: "About" },
      { href: "/privacy.html", label: "Privacy Policy" },
      { href: "/terms.html", label: "Terms of Use" },
    ],
  },
  {
    title: "Contact",
    links: [
      { href: "/contact.html", label: "Contact page" },
      { href: `mailto:${SITE.contactEmail}`, label: SITE.contactEmail },
    ],
  },
  {
    title: "Follow",
    links: [
      { href: "https://buymeacoffee.com/ronakarora1", label: "Support this project", external: true },
      {
        href: "https://www.instagram.com/reposight?igsi=OW96ZzdxeDR2N3Y4&utm_source=ig_contact_invite",
        label: "Instagram",
        external: true,
      },
      { href: "https://www.linkedin.com/company/reposight/", label: "LinkedIn", external: true },
    ],
  },
];
