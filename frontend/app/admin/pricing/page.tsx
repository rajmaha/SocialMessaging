"use client";

import { authAPI } from "@/lib/auth";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import PricingManagement from "@/components/PricingManagement";

export default function PricingPage() {
  const user = authAPI.getUser();

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <h1 className="text-2xl font-semibold mb-4">Pricing Plans</h1>
        <PricingManagement />
      </main>
    </div>
  );
}
