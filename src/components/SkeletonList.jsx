export function SkeletonList() {
  return (
    <div className="skel-wrap">
      {[82, 104, 68, 94, 76].map((h, i) => (
        <div key={i} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}
