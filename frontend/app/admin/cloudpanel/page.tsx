import { redirect } from 'next/navigation';

export default function CloudPanelIndex() {
    redirect('/admin/cloudpanel/servers');
}
