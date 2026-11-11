import Link from 'next/link';

// For empty lists: where to get data from.
export default function LoadDataLink() {
  return (
    <Link href="/sandbox" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
      Load a scenario or reset the data
    </Link>
  );
}
