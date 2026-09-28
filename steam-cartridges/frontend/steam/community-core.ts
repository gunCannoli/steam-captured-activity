export interface CommunityMediaItem {
    id: string;
    url: string;
    title: string;
    appid: number;
}

export function buildWorkshopMediaItems(
    appid: number,
    screenshots: string[] = [],
    artworks: { url: string }[] = [],
    titlescreen?: string,
    fanart?: string,
): CommunityMediaItem[] {
    const urls: string[] = [...screenshots, ...artworks.map((a) => a.url)];
    if (titlescreen) urls.push(titlescreen);
    if (fanart) urls.push(fanart);

    return urls.map((url, idx) => ({
        id: `cartridges_${appid}_${idx}`,
        url,
        title: `Community Media #${idx + 1}`,
        appid,
    }));
}
