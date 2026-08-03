import { INR_CARD, INR_CONTAINER } from './styles';

function Bone({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-white/[0.06] ${className}`} />;
}

export default function InrDepositSkeleton() {
  return (
    <div className={INR_CONTAINER}>
      <Bone className="h-10 w-72 mb-2" />
      <Bone className="h-4 w-96 max-w-full mb-8" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div className={`${INR_CARD} p-6 sm:p-8 space-y-4`}>
          <Bone className="h-12 w-full" />
          <Bone className="h-64 w-full" />
          <Bone className="h-10 w-2/3" />
        </div>
        <div className={`${INR_CARD} p-6 sm:p-8 space-y-4`}>
          <Bone className="h-12 w-full" />
          <Bone className="h-12 w-full" />
          <Bone className="h-32 w-full" />
          <Bone className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
