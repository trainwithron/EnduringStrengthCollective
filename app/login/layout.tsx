// The page is a client component, which cannot name itself; this layout gives it its own tab title.
export const metadata = { title: "Sign in" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
