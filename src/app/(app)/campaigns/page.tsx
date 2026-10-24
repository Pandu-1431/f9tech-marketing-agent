import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listCampaigns } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";

export default async function CampaignsPage() {
  const { workspace } = await requireAuth();
  const campaigns = await listCampaigns(workspace.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new" className="btn">New campaign</Link>
      </div>
      {campaigns.length === 0 ? (
        <div className="card text-sm text-zinc-500">No campaigns yet. Create one from a theme.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-3">Theme</th>
                <th>Business</th>
                <th>Dates</th>
                <th>Platforms</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {campaigns.map(({ campaign, brandName }) => (
                <tr key={campaign.id} className="hover:bg-zinc-50">
                  <td className="px-5 py-3">
                    <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:text-indigo-600">{campaign.theme}</Link>
                  </td>
                  <td>{brandName}</td>
                  <td className="text-zinc-600">{campaign.startDate} → {campaign.endDate}</td>
                  <td className="text-zinc-600">{campaign.platforms.join(", ")}</td>
                  <td><StatusBadge status={campaign.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
