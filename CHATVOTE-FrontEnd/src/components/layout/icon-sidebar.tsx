"use client";

import Link from "next/link";
import Image from "next/image";
import { BarChart3, Heart, MessageCircle, MessageSquareWarning, User, UserCheck } from "lucide-react";
import { Button } from "@components/ui/button";
import LoginButton from "@components/auth/login-button";
import DonationDialog from "@components/donation-dialog";
import FeedbackDialog from "@components/feedback-dialog";
import { useAuth } from "@components/anonymous-auth";
import { cn } from "@lib/utils";

export default function IconSidebar() {
  const auth = useAuth();
  const isAuthenticated = auth.session !== null && !auth.session.isAnonymous;

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
          <Button variant="ghost" size="icon" className={cn("size-10")}>
            <MessageCircle />
          </Button>
        </Link>
        <LoginButton
          isAuthenticated={isAuthenticated}
          noUserChildren={
            <Button variant="ghost" size="icon" className={cn("size-10")}>
              <User />
            </Button>
          }
          userChildren={
            <Button variant="ghost" size="icon" className={cn("size-10")}>
              <UserCheck />
            </Button>
          }
        />
        <DonationDialog>
          <Button variant="donation" size="icon" className={cn("size-10")}>
            <Heart />
          </Button>
        </DonationDialog>
        <Link href="/admin/dashboard/teX6dl-366-_CtBaGFE-0CzgEq1dASS9yES9h6Thnis?tab=pipeline">
          <Button variant="ghost" size="icon" className={cn("size-10")}>
            <BarChart3 />
          </Button>
        </Link>
        <FeedbackDialog>
          <Button variant="ghost" size="icon" className={cn("size-10")}>
            <MessageSquareWarning />
          </Button>
        </FeedbackDialog>
      </div>
    </div>
  );
}
