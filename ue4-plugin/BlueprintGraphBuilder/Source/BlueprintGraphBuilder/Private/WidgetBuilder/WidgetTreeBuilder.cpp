#include "WidgetTreeBuilder.h"
#include "WidgetClassRegistry.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"

FWidgetTreeBuilder::FWidgetTreeBuilder(const FWidgetClassRegistry& InClassRegistry)
	: ClassRegistry(InClassRegistry)
{
}

UWidget* FWidgetTreeBuilder::BuildTree(
	UWidgetBlueprint* WidgetBP,
	UWidgetTree* WidgetTree,
	const FWidgetBlueprintSpec& Spec,
	FString& OutError)
{
	// Build root node with no parent
	return BuildNode(WidgetBP, WidgetTree, Spec.Root, nullptr, Spec.Root.Name, OutError);
}

UWidget* FWidgetTreeBuilder::BuildNode(
	UWidgetBlueprint* WidgetBP,
	UWidgetTree* WidgetTree,
	const FWidgetNodeSpec& Spec,
	UWidget* Parent,
	const FString& Path,
	FString& OutError)
{
	// Step 1: Resolve widget class
	TSubclassOf<UWidget> WidgetClass = ClassRegistry.ResolveWidgetClass(Spec.Type);
	if (!WidgetClass)
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Could not resolve widget class for type '%s'"), *Path, *Spec.Type);
		return nullptr;
	}

	// Step 2: Construct widget
	UWidget* Widget = WidgetTree->ConstructWidget<UWidget>(WidgetClass, FName(*Spec.Name));
	if (!Widget)
	{
		OutError = FString::Printf(TEXT("[WidgetBuilder] %s: ConstructWidget failed for type '%s'"), *Path, *Spec.Type);
		return nullptr;
	}

	UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: Constructed %s as '%s'"), *Path, *Spec.Type, *Spec.Name);

	// Steps 3-6 (properties, attachment, slot, children) will be added in Pass 2+
	// For Pass 1, root widget is returned directly without attachment (root is never attached)

	return Widget;
}
