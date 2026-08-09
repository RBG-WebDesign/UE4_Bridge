// Copyright 2026 RareBird Games. All Rights Reserved.

// ===========================================================================
// assets_cleaner_largest_unused.
//
// Rank unused assets by what they actually cost on disk, using the same
// classification the installed Assets Cleaner plugin (The Tool Shed, v2.00)
// applies in its own browser. That plugin exposes no callable scanner: its
// unused check is a private static handed to a content-browser asset picker as
// a filter delegate (AssetsCleanerUtils::ShouldFilterOutAsset), so there is no
// batch API to front. This command evaluates the IDENTICAL checks against the
// same Asset Registry:
//
//   unused  =  GetReferencers(PackageName, EDependencyCategory::All) == 0
//              AND not named in [/Script/EngineSettings.GameMapsSettings]
//              AND (for World assets) not named in MapsToCook
//
// over the same candidate set: /Game recursive, all classes, with UWorld and
// UMapBuildDataRegistry excluded unless the plugin's own Show Levels setting is
// on. That setting is read from the plugin's UAssetsCleanerSettings CDO through
// reflection rather than a link dependency, because MCPBridgePuerTS must keep
// compiling in projects that do not carry the plugin.
//
// Sizes are stat'ed from the package file on disk (plus .uexp/.ubulk/.uptnl
// sidecars when present, which editor-source packages normally lack), never
// taken from registry metadata, so the reported reclaimable bytes are what the
// filesystem would actually give back.
//
// READ ONLY, structurally: everything works from FAssetData and file stats.
// No asset is loaded, nothing calls Modify or MarkPackageDirty, no transaction
// opens, and the command is deliberately absent from IsToolMutating.
// ===========================================================================

#include "MCPPuerTSBridgeService.h"

#include "AssetRegistryModule.h"
#include "Engine/Blueprint.h"
#include "Engine/MapBuildDataRegistry.h"
#include "Engine/World.h"
#include "HAL/FileManager.h"
#include "Json.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/PackageName.h"
#include "Misc/Paths.h"
#include "Settings/ProjectPackagingSettings.h"
#include "UObject/Class.h"
#include "UObject/UObjectGlobals.h"

namespace
{
    /** One unused package: the deletable unit. Sizes and totals are per
        package because the .uasset file is per package; a package holding two
        assets is one file and must not be counted twice. */
    struct FUnusedPackage
    {
        FName PackageName;
        FString PrimaryAssetName;
        FString PrimaryObjectPath;
        FString PrimaryClass;
        TArray<FString> AssetNames;
        FString FilePath;
        TArray<FString> SidecarFiles;
        int64 PackageBytes = 0;
        int64 SidecarBytes = 0;
        bool bFileFound = false;

        int64 TotalBytes() const { return PackageBytes + SidecarBytes; }
    };

    double ToMegabytes(int64 Bytes)
    {
        return static_cast<double>(Bytes) / (1024.0 * 1024.0);
    }

    /** Mirror of AssetsCleanerUtils::CheckAssetUsedInProjectSettings, including
        its quirk that the GameMapsSettings scan also runs for Blueprint assets
        regardless of the levels toggle. */
    bool UsedInProjectSettings(const FAssetData& Asset, bool bShowLevels)
    {
        const FName WorldClassName = UWorld::StaticClass()->GetFName();
        const bool bIsWorld = Asset.AssetClass == WorldClassName;
        const bool bIsBlueprint = Asset.AssetClass == UBlueprint::StaticClass()->GetFName();
        const FString PackageString = Asset.PackageName.ToString();

        if ((bShowLevels && bIsWorld) || bIsBlueprint)
        {
            TArray<FString> GameSettings;
            if (GConfig->GetSection(TEXT("/Script/EngineSettings.GameMapsSettings"), GameSettings, GEngineIni))
            {
                for (const FString& Entry : GameSettings)
                {
                    if (Entry.Contains(PackageString))
                    {
                        return true;
                    }
                }
            }
        }
        if (bShowLevels && bIsWorld)
        {
            for (const FFilePath& Path : GetDefault<UProjectPackagingSettings>()->MapsToCook)
            {
                if (Path.FilePath.Contains(PackageString))
                {
                    return true;
                }
            }
        }
        return false;
    }

    /** Read bShowLevels off the Assets Cleaner plugin's own settings CDO, by
        reflection so this module never links the plugin. Returns false with
        bOutFound=false when the plugin is not loaded, which matches the
        plugin's shipped default for the setting. */
    bool ReadAssetsCleanerShowLevels(bool& bOutFound)
    {
        bOutFound = false;
        const UClass* SettingsClass =
            FindObject<UClass>(nullptr, TEXT("/Script/AssetsCleaner.AssetsCleanerSettings"));
        if (SettingsClass == nullptr)
        {
            return false;
        }
        const UObject* Defaults = SettingsClass->GetDefaultObject();
        const FBoolProperty* ShowLevels =
            CastField<FBoolProperty>(SettingsClass->FindPropertyByName(TEXT("bShowLevels")));
        if (Defaults == nullptr || ShowLevels == nullptr)
        {
            return false;
        }
        bOutFound = true;
        return ShowLevels->GetPropertyValue_InContainer(Defaults);
    }

    TSharedPtr<FJsonObject> GroupEntry(const FString& Key, const TCHAR* KeyField, int64 Bytes, int32 Count)
    {
        TSharedPtr<FJsonObject> Entry = MakeShared<FJsonObject>();
        Entry->SetStringField(KeyField, Key);
        Entry->SetNumberField(TEXT("bytes"), static_cast<double>(Bytes));
        Entry->SetNumberField(TEXT("mb"), FMath::RoundToDouble(ToMegabytes(Bytes) * 100.0) / 100.0);
        Entry->SetNumberField(TEXT("package_count"), Count);
        return Entry;
    }

    /** Sort a (bytes, count) accumulator map descending and emit at most
        MaxEntries group rows. */
    TArray<TSharedPtr<FJsonValue>> EmitGroups(
        const TMap<FString, TPair<int64, int32>>& Accumulator,
        const TCHAR* KeyField,
        int32 MaxEntries)
    {
        TArray<TPair<FString, TPair<int64, int32>>> Sorted;
        for (const TPair<FString, TPair<int64, int32>>& Pair : Accumulator)
        {
            Sorted.Add(Pair);
        }
        Sorted.Sort([](const TPair<FString, TPair<int64, int32>>& Left,
                       const TPair<FString, TPair<int64, int32>>& Right)
        {
            return Left.Value.Key > Right.Value.Key;
        });
        TArray<TSharedPtr<FJsonValue>> Values;
        for (const TPair<FString, TPair<int64, int32>>& Pair : Sorted)
        {
            if (Values.Num() >= MaxEntries)
            {
                break;
            }
            Values.Add(MakeShared<FJsonValueObject>(
                GroupEntry(Pair.Key, KeyField, Pair.Value.Key, Pair.Value.Value)));
        }
        return Values;
    }
}

bool UMCPPuerTSBridgeService::AssetsCleanerLargestUnusedJson(
    const FString& RequestJson,
    FString& OutResultJson,
    FString& OutError) const
{
    TSharedPtr<FJsonObject> Request;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RequestJson);
    if (!FJsonSerializer::Deserialize(Reader, Request) || !Request.IsValid())
    {
        return Fail(TEXT("invalid_request"), TEXT("The request is not a JSON object."), OutError);
    }

    FString Root = TEXT("/Game");
    Request->TryGetStringField(TEXT("root"), Root);
    Root = Root.TrimStartAndEnd();
    while (Root.Len() > 1 && Root.EndsWith(TEXT("/")))
    {
        Root.LeftChopInline(1);
    }
    if (Root != TEXT("/Game") && (!Root.StartsWith(TEXT("/Game/")) || !FPackageName::IsValidLongPackageName(Root)))
    {
        return Fail(TEXT("path_not_allowed"),
            TEXT("root must be /Game or a valid path under /Game/, matching what Assets Cleaner scans."),
            OutError);
    }

    double MinSizeMb = 0.0;
    Request->TryGetNumberField(TEXT("min_size_mb"), MinSizeMb);
    MinSizeMb = FMath::Max(0.0, MinSizeMb);

    FString ClassFilter;
    Request->TryGetStringField(TEXT("asset_class"), ClassFilter);
    ClassFilter = ClassFilter.TrimStartAndEnd();

    double LimitNumber = 100.0;
    Request->TryGetNumberField(TEXT("limit"), LimitNumber);
    const int32 Limit = FMath::Clamp(static_cast<int32>(LimitNumber), 1, 500);

    bool bSettingsFound = false;
    const bool bPluginShowLevels = ReadAssetsCleanerShowLevels(bSettingsFound);
    bool bIncludeLevels = bPluginShowLevels;
    Request->TryGetBoolField(TEXT("include_levels"), bIncludeLevels);

    const double StartSeconds = FPlatformTime::Seconds();

    // The same candidate filter SAssetsCleaner::UpdateFilter builds: all
    // classes recursively under the root, with the two level classes excluded
    // unless levels are in play. The UObject entry is load bearing for the
    // exclusion set, exactly as the plugin's comment says.
    FAssetRegistryModule& AssetRegistryModule =
        FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
    IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();

    FARFilter Filter;
    Filter.bRecursiveClasses = true;
    Filter.ClassNames.Add(UObject::StaticClass()->GetFName());
    if (!bIncludeLevels)
    {
        Filter.RecursiveClassesExclusionSet.Add(UWorld::StaticClass()->GetFName());
        Filter.RecursiveClassesExclusionSet.Add(UMapBuildDataRegistry::StaticClass()->GetFName());
    }
    Filter.bRecursivePaths = true;
    Filter.PackagePaths.Add(FName(*Root));

    TArray<FAssetData> Assets;
    AssetRegistry.GetAssets(Filter, Assets);

    int32 ScannedAssets = 0;
    int32 UnusedAssets = 0;

    // Classification is per package, because referencers are tracked per
    // package and the file on disk is the package. A package is unused only
    // when it has zero referencers AND none of its assets trip the project
    // settings check.
    TMap<FName, FUnusedPackage> UnusedPackages;
    TSet<FName> ScannedPackages;
    TSet<FName> UsedPackages;

    for (const FAssetData& Asset : Assets)
    {
        if (!ClassFilter.IsEmpty()
            && !Asset.AssetClass.ToString().Contains(ClassFilter, ESearchCase::IgnoreCase))
        {
            continue;
        }
        ++ScannedAssets;
        ScannedPackages.Add(Asset.PackageName);
        if (UsedPackages.Contains(Asset.PackageName))
        {
            continue;
        }

        if (!UnusedPackages.Contains(Asset.PackageName))
        {
            TArray<FName> Referencers;
            AssetRegistry.GetReferencers(Asset.PackageName, Referencers, UE::AssetRegistry::EDependencyCategory::All);
            if (Referencers.Num() > 0)
            {
                UsedPackages.Add(Asset.PackageName);
                continue;
            }
        }
        if (UsedInProjectSettings(Asset, bIncludeLevels))
        {
            UsedPackages.Add(Asset.PackageName);
            UnusedPackages.Remove(Asset.PackageName);
            continue;
        }

        FUnusedPackage& Record = UnusedPackages.FindOrAdd(Asset.PackageName);
        Record.PackageName = Asset.PackageName;
        Record.AssetNames.Add(Asset.AssetName.ToString());
        // The package's headline asset is the one named like the package;
        // otherwise the first one seen.
        const FString PackageBaseName = FPackageName::GetLongPackageAssetName(Asset.PackageName.ToString());
        if (Record.PrimaryAssetName.IsEmpty() || Asset.AssetName.ToString() == PackageBaseName)
        {
            Record.PrimaryAssetName = Asset.AssetName.ToString();
            Record.PrimaryObjectPath = Asset.ObjectPath.ToString();
            Record.PrimaryClass = Asset.AssetClass.ToString();
        }
    }

    // Stat every unused package's file, plus any cooked-style sidecars sitting
    // next to it. Editor-source packages are normally a single file; checking
    // costs one stat each and keeps the reclaimable number honest when a
    // sidecar does exist.
    static const TCHAR* SidecarExtensions[] = { TEXT(".uexp"), TEXT(".ubulk"), TEXT(".uptnl") };
    int64 TotalUnusedBytes = 0;
    int32 MissingFiles = 0;
    IFileManager& FileManager = IFileManager::Get();
    for (TPair<FName, FUnusedPackage>& Pair : UnusedPackages)
    {
        FUnusedPackage& Record = Pair.Value;
        UnusedAssets += Record.AssetNames.Num();
        FString Filename;
        if (FPackageName::DoesPackageExist(Record.PackageName.ToString(), nullptr, &Filename))
        {
            Record.bFileFound = true;
            Record.FilePath = FPaths::ConvertRelativePathToFull(Filename);
            Record.PackageBytes = FileManager.FileSize(*Record.FilePath);
            const FString BasePath = FPaths::ChangeExtension(Record.FilePath, TEXT(""));
            for (const TCHAR* Extension : SidecarExtensions)
            {
                const FString SidecarPath = BasePath + Extension;
                const int64 SidecarSize = FileManager.FileSize(*SidecarPath);
                if (SidecarSize > 0)
                {
                    Record.SidecarFiles.Add(SidecarPath);
                    Record.SidecarBytes += SidecarSize;
                }
            }
            TotalUnusedBytes += Record.TotalBytes();
        }
        else
        {
            ++MissingFiles;
        }
    }

    TArray<FUnusedPackage> Ranked;
    UnusedPackages.GenerateValueArray(Ranked);
    Ranked.Sort([](const FUnusedPackage& Left, const FUnusedPackage& Right)
    {
        return Left.TotalBytes() > Right.TotalBytes();
    });

    // Groupings cover the whole unused set inside the root/class scope, not
    // just the rows that survive min_size_mb and limit, so the totals stay
    // true whatever the list shaping says.
    TMap<FString, TPair<int64, int32>> ByTopFolder;
    TMap<FString, TPair<int64, int32>> ByClass;
    TMap<FString, TPair<int64, int32>> ByFolder;
    for (const FUnusedPackage& Record : Ranked)
    {
        const FString PackageString = Record.PackageName.ToString();
        const FString Folder = FPackageName::GetLongPackagePath(PackageString);
        // "/Game/Foo/Bar" -> "/Game/Foo"; assets directly in /Game keep "/Game".
        FString TopLevel = Folder;
        const int32 SecondSlash = Folder.Find(TEXT("/"), ESearchCase::CaseSensitive, ESearchDir::FromStart, 6);
        if (SecondSlash != INDEX_NONE)
        {
            TopLevel = Folder.Left(SecondSlash);
        }
        const int64 Bytes = Record.TotalBytes();
        TPair<int64, int32>& TopEntry = ByTopFolder.FindOrAdd(TopLevel);
        TopEntry.Key += Bytes; TopEntry.Value += 1;
        TPair<int64, int32>& ClassEntry = ByClass.FindOrAdd(Record.PrimaryClass);
        ClassEntry.Key += Bytes; ClassEntry.Value += 1;
        TPair<int64, int32>& FolderEntry = ByFolder.FindOrAdd(Folder);
        FolderEntry.Key += Bytes; FolderEntry.Value += 1;
    }

    const int64 MinSizeBytes = static_cast<int64>(MinSizeMb * 1024.0 * 1024.0);
    TArray<TSharedPtr<FJsonValue>> Rows;
    for (const FUnusedPackage& Record : Ranked)
    {
        if (Rows.Num() >= Limit)
        {
            break;
        }
        if (Record.TotalBytes() < MinSizeBytes)
        {
            break; // Ranked is sorted descending; nothing after this passes.
        }
        TSharedPtr<FJsonObject> Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("asset_name"), Record.PrimaryAssetName);
        Row->SetStringField(TEXT("object_path"), Record.PrimaryObjectPath);
        Row->SetStringField(TEXT("package_path"), Record.PackageName.ToString());
        Row->SetStringField(TEXT("asset_class"), Record.PrimaryClass);
        Row->SetNumberField(TEXT("size_bytes"), static_cast<double>(Record.TotalBytes()));
        Row->SetNumberField(TEXT("size_mb"), FMath::RoundToDouble(ToMegabytes(Record.TotalBytes()) * 100.0) / 100.0);
        Row->SetBoolField(TEXT("assets_cleaner_unused"), true);
        Row->SetNumberField(TEXT("referencer_count"), 0);
        Row->SetStringField(TEXT("file_path"), Record.FilePath);
        Row->SetBoolField(TEXT("file_found"), Record.bFileFound);
        if (Record.SidecarFiles.Num() > 0)
        {
            TArray<TSharedPtr<FJsonValue>> Sidecars;
            for (const FString& Sidecar : Record.SidecarFiles)
            {
                Sidecars.Add(MakeShared<FJsonValueString>(Sidecar));
            }
            Row->SetArrayField(TEXT("sidecar_files"), Sidecars);
            Row->SetNumberField(TEXT("sidecar_bytes"), static_cast<double>(Record.SidecarBytes));
        }
        if (Record.AssetNames.Num() > 1)
        {
            TArray<TSharedPtr<FJsonValue>> Names;
            for (const FString& Name : Record.AssetNames)
            {
                Names.Add(MakeShared<FJsonValueString>(Name));
            }
            Row->SetArrayField(TEXT("all_asset_names"), Names);
        }
        Row->SetNumberField(TEXT("assets_in_package"), Record.AssetNames.Num());
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("root"), Root);
    Result->SetNumberField(TEXT("min_size_mb"), MinSizeMb);
    Result->SetStringField(TEXT("asset_class_filter"), ClassFilter);
    Result->SetNumberField(TEXT("limit"), Limit);
    Result->SetBoolField(TEXT("include_levels"), bIncludeLevels);

    TSharedPtr<FJsonObject> Cleaner = MakeShared<FJsonObject>();
    Cleaner->SetBoolField(TEXT("plugin_settings_found"), bSettingsFound);
    Cleaner->SetBoolField(TEXT("show_levels_setting"), bPluginShowLevels);
    Cleaner->SetStringField(TEXT("classification"),
        TEXT("Identical checks to AssetsCleanerUtils::ShouldFilterOutAsset: zero package referencers ")
        TEXT("(EDependencyCategory::All) and no GameMapsSettings/MapsToCook match. The plugin exposes ")
        TEXT("no callable scanner, so the checks are evaluated here against the same Asset Registry."));
    Result->SetObjectField(TEXT("assets_cleaner"), Cleaner);

    Result->SetNumberField(TEXT("scanned_assets"), ScannedAssets);
    Result->SetNumberField(TEXT("scanned_packages"), ScannedPackages.Num());
    Result->SetNumberField(TEXT("unused_packages"), UnusedPackages.Num());
    Result->SetNumberField(TEXT("unused_assets"), UnusedAssets);
    Result->SetNumberField(TEXT("missing_files"), MissingFiles);
    Result->SetNumberField(TEXT("total_unused_bytes"), static_cast<double>(TotalUnusedBytes));
    Result->SetNumberField(TEXT("total_unused_mb"), FMath::RoundToDouble(ToMegabytes(TotalUnusedBytes) * 100.0) / 100.0);
    Result->SetNumberField(TEXT("total_unused_gb"), FMath::RoundToDouble(ToMegabytes(TotalUnusedBytes) / 1024.0 * 1000.0) / 1000.0);
    Result->SetNumberField(TEXT("scan_seconds"), FPlatformTime::Seconds() - StartSeconds);

    Result->SetArrayField(TEXT("top_assets"), Rows);
    Result->SetArrayField(TEXT("by_top_level_folder"), EmitGroups(ByTopFolder, TEXT("folder"), 1000));
    Result->SetArrayField(TEXT("by_class"), EmitGroups(ByClass, TEXT("asset_class"), 1000));
    Result->SetArrayField(TEXT("top_folders"), EmitGroups(ByFolder, TEXT("folder"), 50));

    OutResultJson = SerializeJson(Result);
    return true;
}
