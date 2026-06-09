import HitlWorkspace from '@/components/HitlWorkspace';

export default function DemoPage() {
    return (
        <div className="h-screen w-full overflow-hidden">
            <HitlWorkspace isDemoMode={true} />
        </div>
    );
}
