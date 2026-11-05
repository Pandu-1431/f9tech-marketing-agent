import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canEditContent } from "@/lib/team";
import { listCampaigns } from "@/lib/data";
import { StatusBadge } from "@/components/status-badge";
import { campaignTypeLabel } from "@/lib/campaign-types";

export default async function CampaignsPage() {
  const { workspace, role } = await requireAuth();
  const canEdit = canEditContent(role);
  const campaigns = await listCampaigns(workspace.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        {canEdit && <Link href="/campaigns/new" className="btn">New campaign</Link>}
      </div>
      {campaigns.length === 0 ? (
        <div className="card text-sm text-zinc-500">No campaigns yet. Create one from a theme.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="px-5 py-3">Theme</th>
                <th>Type</th>
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
                    {campaign.source === "autopilot" && <span className="badge ml-2 bg-indigo-50 text-indigo-700">Autopilot</span>}
                  </td>
                  <td className="text-zinc-600">{campaignTypeLabel(campaign.campaignType)}</td>
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
