using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;

namespace erosia;

public sealed class MovieExternalId : IExternalId
{
    public string Name => "番号";
    public string Key => "erosia";
    public string UrlFormatString => "";
    public bool Supports(IHasProviderIds item) => item is Movie;
}
