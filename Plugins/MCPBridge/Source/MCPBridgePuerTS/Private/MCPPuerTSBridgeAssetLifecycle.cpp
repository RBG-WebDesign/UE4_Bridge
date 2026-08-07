// Copyright 2026 RareBird Games. All Rights Reserved.

// ===========================================================================
// asset_move and asset_create.
//
// Both exist because the bridge could inspect and delete assets but could not
// move or make one, so every relocation and every new Data Asset needed a human
// in the Content Browser. That cost is what motivated these two.
//
// WHY IAssetTools AND NOT A FILE MOVE. A UE package records its own package
// path. Copying the file to a new folder leaves it declaring the old path and
// the editor rejects it on load; for a .umap this is guaranteed, not a risk.
// IAssetTools::RenameAssets rewrites that path AND leaves a UObjectRedirector
// at the old location, which is what keeps existing referencers resolving. It
// also routes through the source-control provider, so a Perforce project gets a
// proper move/delete + move/add pair instead of a writable file the server does
// not know about. Nothing here touches IFileManager.
//
// SAVE IS NOT A SEPARATE STEP THE CALLER CAN FORGET. Both commands save what
// they produced before returning, because an unsaved rename or an unsaved new
// asset is a change that exists only in the editor's memory and vanishes on the
// next load. A caller that wanted the in-memory state would have no way to
// verify it.
// ===========================================================================

#include "MCPPuerTSBridgeService.h"

#include "AssetRegistryModule.h"
// FAssetRenameData is declared in IAssetTools.h in 4.27, not in a header of its
// own. There is no AssetRenameData.h to include.
#include "AssetToolsModule.h"
#include "Editor.h"
#include "Engine/DataAsset.h"
#include "FileHelpers.h"
#include "IAssetTools.h"
#include "Json.h"
#include "Misc/PackageName.h"
#include "UObject/Package.h"
#include "UObject/UObjectGlobals.h"

namespace
{
    /** Split "/Game/A/B" into "/Game/A" and "B". Returns false on anything that
        is not a valid long package name under /Game/. */
    bool SplitGamePackagePath(const FString& InPath, FString& OutDirectory, FString& OutName, FString& OutError)
    {
        FString PackageName = InPath.TrimStartAndEnd();
        if (PackageName.Contains(TEXT(".")))
        {
            PackageName = FPackageName::ObjectPathToPackageName(PackageName);
        }
        if (!PackageName.StartsWith(TEXT("/Game/")) || !FPackageName::IsValidLongPackageName(PackageName))
        {
            OutError = FString::Printf(
                TEXT("'%s' is not a valid package path under /Game/."), *InPath);
            return false;
        }
        OutName = FPackageName::GetLongPackageAssetName(PackageName);
        OutDirectory = FPackageName::GetLongPackagePath(PackageName);
        if (OutName.IsEmpty() || OutDirectory.IsEmpty())
        {
            OutError = FString::Printf(TEXT("'%s' has no package directory or asset name."), *InPath);
            return false;
        }
        return true;
    }

    FString ObjectPathFor(const FString& PackageName)
    {
        return PackageName + TEXT(".") + FPackageName::GetLongPackageAssetName(PackageName);
    }
}

bool UMCPPuerTSBridgeService::MoveAssetJson(
    const FString& SourcePath,
    const FString& DestinationPath,
    FString& OutResultJson,
    FString& OutError)
{
    FString SourceDir, SourceName, DestDir, DestName;
    if (!SplitGamePackagePath(SourcePath, SourceDir, SourceName, OutError)) { return false; }
    if (!SplitGamePackagePath(DestinationPath, DestDir, DestName, OutError)) { return false; }

    const FString SourcePackage = SourceDir / SourceName;
    const FString DestPackage = DestDir / DestName;
    if (SourcePackage == DestPackage)
    {
        OutError = TEXT("The source and destination are the same package path.");
        return false;
    }

    FAssetRegistryModule& AssetRegistryModule =
        FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
    IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();

    const FAssetData SourceData = AssetRegistry.GetAssetByObjectPath(FName(*ObjectPathFor(SourcePackage)));
    if (!SourceData.IsValid())
    {
        OutError = FString::Printf(TEXT("No asset found at '%s'."), *SourcePackage);
        return false;
    }

    // Refuse an overwrite rather than supporting one. RenameAssets would resolve
    // a collision by inventing a suffix, which is exactly the silent _2 rename
    // this command exists to stop happening by hand.
    const FAssetData ExistingDest = AssetRegistry.GetAssetByObjectPath(FName(*ObjectPathFor(DestPackage)));
    if (ExistingDest.IsValid() || FPackageName::DoesPackageExist(DestPackage))
    {
        OutError = FString::Printf(
            TEXT("'%s' already exists. asset_move refuses to overwrite; delete or rename the destination first."),
            *DestPackage);
        return false;
    }

    // The open level cannot be renamed out from under the editor.
    if (GEditor != nullptr)
    {
        UWorld* EditorWorld = GEditor->GetEditorWorldContext().World();
        if (EditorWorld != nullptr && EditorWorld->GetOutermost()->GetFName() == SourceData.PackageName)
        {
            OutError = TEXT("The currently open level cannot be moved. Load another level first.");
            return false;
        }
    }

    UObject* Asset = SourceData.GetAsset();
    if (Asset == nullptr)
    {
        OutError = FString::Printf(TEXT("The asset at '%s' could not be loaded."), *SourcePackage);
        return false;
    }

    FAssetToolsModule& AssetToolsModule =
        FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));

    TArray<FAssetRenameData> Renames;
    Renames.Add(FAssetRenameData(Asset, DestDir, DestName));
    const bool bRenamed = AssetToolsModule.Get().RenameAssets(Renames);

    // Verify from the registry rather than trusting the return value: a partial
    // rename reports true in some 4.27 paths, and the whole point of this
    // command is that the caller can trust where the asset ended up.
    AssetRegistry.ScanPathsSynchronous({ SourceDir, DestDir }, /*bForceRescan=*/true);
    const FAssetData MovedData = AssetRegistry.GetAssetByObjectPath(FName(*ObjectPathFor(DestPackage)));
    const bool bLandedAtDestination = MovedData.IsValid();

    // A redirector at the old path is the mechanism that keeps referencers
    // working. Report whether one exists rather than assuming it does.
    const FAssetData OldPathData = AssetRegistry.GetAssetByObjectPath(FName(*ObjectPathFor(SourcePackage)));
    const bool bRedirectorLeft = OldPathData.IsValid()
        && OldPathData.AssetClass == UObjectRedirector::StaticClass()->GetFName();

    if (!bRenamed || !bLandedAtDestination)
    {
        OutError = FString::Printf(
            TEXT("The move of '%s' to '%s' did not complete; the destination has no asset. See the Output Log."),
            *SourcePackage, *DestPackage);
        return false;
    }

    // Save the moved package and the redirector so the move survives a reload.
    TArray<UPackage*> ToSave;
    if (UPackage* MovedPackage = MovedData.GetPackage()) { ToSave.Add(MovedPackage); }
    if (OldPathData.IsValid())
    {
        if (UPackage* OldPackage = OldPathData.GetPackage()) { ToSave.AddUnique(OldPackage); }
    }
    const bool bSaved = ToSave.Num() > 0
        ? UEditorLoadingAndSavingUtils::SavePackages(ToSave, /*bOnlyDirty=*/false)
        : false;

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("old_path"), SourcePackage);
    Result->SetStringField(TEXT("new_path"), DestPackage);
    Result->SetStringField(TEXT("new_object_path"), MovedData.ObjectPath.ToString());
    Result->SetStringField(TEXT("asset_class"), MovedData.AssetClass.ToString());
    Result->SetBoolField(TEXT("moved"), true);
    Result->SetBoolField(TEXT("redirector_left"), bRedirectorLeft);
    Result->SetBoolField(TEXT("saved"), bSaved);
    OutResultJson = SerializeJson(Result);
    return true;
}

bool UMCPPuerTSBridgeService::CreateDataAssetJson(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& ClassPath,
    FString& OutResultJson,
    FString& OutError)
{
    const FString Directory = PackagePath.TrimStartAndEnd();
    const FString Name = AssetName.TrimStartAndEnd();
    if (!Directory.StartsWith(TEXT("/Game/")))
    {
        OutError = FString::Printf(TEXT("'%s' is not a package directory under /Game/."), *Directory);
        return false;
    }
    if (Name.IsEmpty() || !FPackageName::IsValidLongPackageName(Directory / Name))
    {
        OutError = FString::Printf(TEXT("'%s' is not a valid asset name in '%s'."), *Name, *Directory);
        return false;
    }
    const FString FullPackage = Directory / Name;

    if (FPackageName::DoesPackageExist(FullPackage) || FindPackage(nullptr, *FullPackage) != nullptr)
    {
        OutError = FString::Printf(
            TEXT("'%s' already exists. asset_create refuses to overwrite."), *FullPackage);
        return false;
    }

    UClass* AssetClass = LoadClass<UObject>(nullptr, *ClassPath);
    if (AssetClass == nullptr)
    {
        // A Blueprint-generated class is named with a _C suffix; a native class
        // is not. Say which forms are accepted rather than just "not found".
        OutError = FString::Printf(
            TEXT("Could not resolve class '%s'. Use a full class path, for example ")
            TEXT("/Script/Sinfeld_Demo.SFLevelConfig for a native class or ")
            TEXT("/Game/Path/BP_Thing.BP_Thing_C for a Blueprint class."),
            *ClassPath);
        return false;
    }

    // The allowlist for this command is the type system: a UDataAsset subclass
    // and nothing else. Creating arbitrary UObjects by class name would be a far
    // wider surface than "make me a Data Asset", and every other asset kind in
    // this bridge already has a purpose-built builder that validates its own spec.
    if (!AssetClass->IsChildOf(UDataAsset::StaticClass()))
    {
        OutError = FString::Printf(
            TEXT("'%s' is not a UDataAsset subclass. asset_create makes Data Assets only; ")
            TEXT("use the dedicated builder for Blueprints, materials, widgets and the rest."),
            *ClassPath);
        return false;
    }
    if (AssetClass->HasAnyClassFlags(CLASS_Abstract | CLASS_Deprecated | CLASS_NewerVersionExists))
    {
        OutError = FString::Printf(TEXT("'%s' is abstract or deprecated and cannot be instantiated."), *ClassPath);
        return false;
    }

    UPackage* Package = CreatePackage(*FullPackage);
    if (Package == nullptr)
    {
        OutError = FString::Printf(TEXT("Could not create the package '%s'."), *FullPackage);
        return false;
    }

    UObject* NewAsset = NewObject<UObject>(Package, AssetClass, FName(*Name), RF_Public | RF_Standalone);
    if (NewAsset == nullptr)
    {
        OutError = FString::Printf(TEXT("Could not construct a '%s' in '%s'."), *ClassPath, *FullPackage);
        return false;
    }

    FAssetRegistryModule::AssetCreated(NewAsset);
    Package->MarkPackageDirty();

    TArray<UPackage*> ToSave;
    ToSave.Add(Package);
    const bool bSaved = UEditorLoadingAndSavingUtils::SavePackages(ToSave, /*bOnlyDirty=*/false);
    if (!bSaved)
    {
        OutError = FString::Printf(
            TEXT("'%s' was created in memory but could not be saved. It will not survive a reload."),
            *FullPackage);
        return false;
    }

    TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("asset_path"), FullPackage);
    Result->SetStringField(TEXT("object_path"), NewAsset->GetPathName());
    Result->SetStringField(TEXT("asset_class"), AssetClass->GetPathName());
    Result->SetStringField(TEXT("asset_name"), Name);
    Result->SetBoolField(TEXT("created"), true);
    Result->SetBoolField(TEXT("saved"), true);
    OutResultJson = SerializeJson(Result);
    return true;
}
