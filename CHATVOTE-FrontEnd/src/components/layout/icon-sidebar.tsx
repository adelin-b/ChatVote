import Link from "next/link";
import Image from "next/image";
import { Heart, MessageCircle, MessageSquareWarning, User } from "lucide-react";
import { Button } from "@components/ui/button";

export default function IconSidebar() {
  return (
    <div className="hidden h-screen w-16 flex-none flex-col items-center gap-12 overflow-hidden border-r border-border-subtle bg-surface px-2 py-4 md:flex">
      <div className="flex flex-col items-center">
        <Link href="https://tndm.fr" className="flex items-center">
          <Image
            src="/images/logos/tandem.svg"
            alt="tandem"
            width={0}
            height={0}
            sizes="100vw"
            className="logo-theme size-12"
          />
        </Link>
      </div>
      <div className="flex flex-col items-center gap-4">
        <Link href="/chat">
          <Button variant="ghost" size="icon" className="size-10">
            <MessageCircle className="size-5" />
          </Button>
        </Link>
        <Button variant="ghost" size="icon" className="size-10">
          <User className="size-5" />
        </Button>
        <Button variant="secondary" size="icon" className="size-10">
          <Heart className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-10">
          <MessageSquareWarning className="size-5" />
        </Button>
      </div>
    </div>
  );
}
