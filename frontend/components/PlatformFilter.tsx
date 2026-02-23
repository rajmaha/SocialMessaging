interface PlatformFilterProps {
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
}

export default function PlatformFilter({
  selectedPlatform,
  onPlatformChange,
}: PlatformFilterProps) {
  const platforms = [
    { id: 'all', name: 'All', color: 'bg-gray-500' },
    { id: 'whatsapp', name: 'WhatsApp', color: 'bg-green-500' },
    { id: 'facebook', name: 'Facebook', color: 'bg-blue-600' },
    { id: 'viber', name: 'Viber', color: 'bg-purple-600' },
    { id: 'linkedin', name: 'LinkedIn', color: 'bg-blue-700' },
  ]

  return (
    <div className="p-4 border-b">
      <p className="text-xs text-gray-600 mb-3 font-semibold">FILTER BY PLATFORM</p>
      <div className="flex gap-2 flex-wrap">
        {platforms.map((platform) => (
          <button
            key={platform.id}
            onClick={() => onPlatformChange(platform.id)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              selectedPlatform === platform.id
                ? `${platform.color} text-white`
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {platform.name}
          </button>
        ))}
      </div>
    </div>
  )
}
