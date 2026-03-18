#include "WidgetClassRegistry.h"
#include "Components/CanvasPanel.h"
#include "Components/VerticalBox.h"
#include "Components/HorizontalBox.h"
#include "Components/Overlay.h"
#include "Components/Widget.h"
#include "Components/TextBlock.h"
#include "Components/Image.h"
#include "Components/Spacer.h"

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

	// Pass 2: Leaf widgets
	FWidgetTypeInfo TextBlockInfo;
	TextBlockInfo.WidgetClass = UTextBlock::StaticClass();
	TextBlockInfo.Category = EWidgetCategory::Leaf;
	TypeRegistry.Add(TEXT("TextBlock"), MoveTemp(TextBlockInfo));

	FWidgetTypeInfo ImageInfo;
	ImageInfo.WidgetClass = UImage::StaticClass();
	ImageInfo.Category = EWidgetCategory::Leaf;
	TypeRegistry.Add(TEXT("Image"), MoveTemp(ImageInfo));

	FWidgetTypeInfo SpacerInfo;
	SpacerInfo.WidgetClass = USpacer::StaticClass();
	SpacerInfo.Category = EWidgetCategory::Leaf;
	TypeRegistry.Add(TEXT("Spacer"), MoveTemp(SpacerInfo));

	// Pass 3: Layout panels
	FWidgetTypeInfo VerticalBoxInfo;
	VerticalBoxInfo.WidgetClass = UVerticalBox::StaticClass();
	VerticalBoxInfo.Category = EWidgetCategory::Panel;
	TypeRegistry.Add(TEXT("VerticalBox"), MoveTemp(VerticalBoxInfo));

	FWidgetTypeInfo HorizontalBoxInfo;
	HorizontalBoxInfo.WidgetClass = UHorizontalBox::StaticClass();
	HorizontalBoxInfo.Category = EWidgetCategory::Panel;
	TypeRegistry.Add(TEXT("HorizontalBox"), MoveTemp(HorizontalBoxInfo));

	FWidgetTypeInfo OverlayInfo;
	OverlayInfo.WidgetClass = UOverlay::StaticClass();
	OverlayInfo.Category = EWidgetCategory::Panel;
	TypeRegistry.Add(TEXT("Overlay"), MoveTemp(OverlayInfo));
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
