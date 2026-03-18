#include "WidgetClassRegistry.h"
#include "Components/CanvasPanel.h"
#include "Components/Widget.h"

FWidgetClassRegistry::FWidgetClassRegistry()
{
	RegisterTypes();
}

void FWidgetClassRegistry::RegisterTypes()
{
	// Pass 1: CanvasPanel only
	FWidgetTypeInfo CanvasPanelInfo;
	CanvasPanelInfo.WidgetClass = UCanvasPanel::StaticClass();
	CanvasPanelInfo.Category = EWidgetCategory::Panel;
	// No properties for CanvasPanel in v1
	TypeRegistry.Add(TEXT("CanvasPanel"), MoveTemp(CanvasPanelInfo));
}

TSubclassOf<UWidget> FWidgetClassRegistry::ResolveWidgetClass(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? Info->WidgetClass : nullptr;
}

bool FWidgetClassRegistry::IsSupportedType(const FString& TypeName) const
{
	return TypeRegistry.Contains(TypeName);
}

EWidgetCategory FWidgetClassRegistry::GetCategory(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? Info->Category : EWidgetCategory::Leaf;
}

TArray<FString> FWidgetClassRegistry::GetSupportedTypes() const
{
	TArray<FString> Types;
	TypeRegistry.GetKeys(Types);
	return Types;
}

const TArray<FWidgetPropertyDescriptor>* FWidgetClassRegistry::GetSupportedProperties(const FString& TypeName) const
{
	const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
	return Info ? &Info->SupportedProperties : nullptr;
}
